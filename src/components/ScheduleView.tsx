import { useRef, useState, type FormEvent } from "react";
import {
  daysStringToFlags,
  flagsToDaysString,
  formatTimeDisplay,
  validateSchedule,
  type Schedule,
} from "@/protocol";
import { useFeederSnapshot, useFeederStore } from "@/state/feeder-context";
import type { FeederSnapshot } from "@/state/feeder-store";
import { StatusBanner } from "./StatusBanner";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

interface ScheduleForm {
  label: string;
  time: string;
  daysOfWeek: string;
  enabled: boolean;
}

const emptyForm: ScheduleForm = {
  label: "",
  time: "08:00",
  daysOfWeek: "",
  enabled: true,
};

export function ScheduleView() {
  const snapshot = useFeederSnapshot();
  return <ScheduleEditor key={snapshot.isConnected ? snapshot.chipId : "disconnected"} snapshot={snapshot} />;
}

function ScheduleEditor({ snapshot }: { snapshot: FeederSnapshot }) {
  const store = useFeederStore();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<{ id: string; isNew: boolean } | null>(null);
  const [form, setForm] = useState<ScheduleForm>(emptyForm);
  const [errors, setErrors] = useState<string[]>([]);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const saving = snapshot.scheduleState === "saving";
  const loading = snapshot.scheduleState === "loading" || snapshot.scheduleState === "unloaded";
  const canEdit = snapshot.isConnected && snapshot.scheduleState === "ready" && !snapshot.clockSyncPending;

  function openAdd(): void {
    setDraft({ id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`, isNew: true });
    setForm(emptyForm);
    setErrors([]);
  }

  function openEdit(schedule: Schedule): void {
    setDraft({ id: schedule.id, isNew: false });
    setForm({
      label: schedule.label,
      time: schedule.time,
      daysOfWeek: schedule.daysOfWeek,
      enabled: schedule.enabled,
    });
    setErrors([]);
  }

  function closeDialog(): void {
    if (saving) return;
    dialogRef.current?.close?.();
    setDraft(null);
    setErrors([]);
  }

  function toggleDay(index: number): void {
    const days = daysStringToFlags(form.daysOfWeek);
    days[index] = !days[index];
    setForm((current) => ({ ...current, daysOfWeek: flagsToDaysString(days) }));
  }

  async function saveSchedule(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canEdit || !draft) return;
    const existing = snapshot.schedules.find((item) => item.id === draft.id);
    if (!draft.isNew && !existing) {
      setErrors(["This schedule was removed. Close the editor and reload the list."]);
      return;
    }
    const schedule: Schedule = {
      id: draft.id,
      label: form.label.trim(),
      time: form.time,
      daysOfWeek: form.daysOfWeek,
      augerSpeed: existing?.augerSpeed ?? 768,
      impellerSpeed: existing?.impellerSpeed ?? 1023,
      preSpinMs: existing?.preSpinMs ?? 1500,
      feedMs: existing?.feedMs ?? 3000,
      postSpinMs: existing?.postSpinMs ?? 1500,
      enabled: form.enabled,
    };
    const validationErrors = validateSchedule(schedule);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    const updated = existing
      ? snapshot.schedules.map((item) => (item.id === draft.id ? schedule : item))
      : [...snapshot.schedules, schedule];
    const ok = await store.publishScheduleSync(updated);
    if (ok) closeDialog();
  }

  async function toggleEnabled(schedule: Schedule): Promise<void> {
    await store.publishScheduleSync(
      snapshot.schedules.map((item) =>
        item.id === schedule.id ? { ...item, enabled: !item.enabled } : item,
      ),
    );
  }

  async function deleteSchedule(schedule: Schedule): Promise<void> {
    const ok = await store.publishScheduleSync(snapshot.schedules.filter((item) => item.id !== schedule.id));
    if (ok) setDeleteId(null);
  }

  return (
    <div className="view-stack">
      {snapshot.isConnected && !snapshot.clockSynced ? (
        <StatusBanner tone="warning">
          {snapshot.clockSyncPending
            ? "Syncing the feeder clock…"
            : "The feeder clock is not confirmed. Scheduled feeds may not run."}
          {snapshot.clockError ? <p>{snapshot.clockError}</p> : null}
          <button
            type="button"
            className="button button--quiet"
            disabled={loading || saving || snapshot.clockSyncPending}
            onClick={() => void store.syncClock()}
          >
            Retry clock sync
          </button>
        </StatusBanner>
      ) : null}
      {snapshot.scheduleError && !draft ? (
        <StatusBanner tone="error">
          {snapshot.scheduleError}
          {snapshot.scheduleState === "error" ? (
            <button type="button" className="button button--quiet" disabled={snapshot.clockSyncPending} onClick={() => void store.reloadSchedules()}>
              Reload schedules
            </button>
          ) : null}
        </StatusBanner>
      ) : null}
      <section className="panel" aria-labelledby="schedule-list-heading">
        <div className="panel-heading">
          <div>
            <h2 id="schedule-list-heading">Feeding schedule</h2>
            <p className="panel-subtitle">Up to 10 schedules are stored on the feeder.</p>
          </div>
          <button type="button" className="button button--primary" onClick={openAdd} disabled={!canEdit}>Add schedule</button>
        </div>

        {saving ? <p role="status">Saving schedules…</p> : null}
        {!snapshot.isConnected ? (
          <p>Connect to a feeder to view its schedules.</p>
        ) : loading ? (
          <p role="status">Loading schedules…</p>
        ) : snapshot.scheduleState === "error" && snapshot.schedules.length === 0 ? null : snapshot.schedules.length === 0 ? (
          <div className="empty-state">
            <strong>No schedules</strong>
            <span>Add a time and at least one weekday to begin.</span>
          </div>
        ) : (
          <div className="schedule-list">
            {snapshot.schedules.map((schedule) => {
              const days = daysStringToFlags(schedule.daysOfWeek);
              return (
                <article className="schedule-row" key={schedule.id}>
                  <div className="schedule-main">
                    <div>
                      <h3>{schedule.label}</h3>
                      <p className="schedule-time">{formatTimeDisplay(schedule.time)}</p>
                    </div>
                    <div className="weekday-list" aria-label={`Runs on ${schedule.daysOfWeek}`}>
                      {days.map((selected, index) => (
                        <span className={selected ? "weekday weekday--selected" : "weekday"} key={DAY_LABELS[index]}>
                          {DAY_LABELS[index].slice(0, 2)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="schedule-actions">
                    <label className="switch-label">
                      <input
                        type="checkbox"
                        checked={schedule.enabled}
                        disabled={!canEdit}
                        onChange={() => void toggleEnabled(schedule)}
                      />
                      <span>Enabled</span>
                    </label>
                    <button type="button" className="button button--quiet" onClick={() => openEdit(schedule)} aria-label={`Edit ${schedule.label}`} disabled={!canEdit}>
                      Edit
                    </button>
                    {deleteId === schedule.id ? (
                      <>
                        <button type="button" className="button button--danger" onClick={() => void deleteSchedule(schedule)} disabled={!canEdit}>Confirm delete</button>
                        <button type="button" className="button button--quiet" onClick={() => setDeleteId(null)}>Cancel</button>
                      </>
                    ) : (
                      <button type="button" className="button button--quiet button--danger-text" onClick={() => setDeleteId(schedule.id)} aria-label={`Delete ${schedule.label}`} disabled={!canEdit}>
                        Delete
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {draft ? (
        <dialog
          className="modal"
          ref={(dialog) => {
            dialogRef.current = dialog;
            if (!dialog || dialog.open) return;
            if (dialog.showModal) dialog.showModal();
            else dialog.setAttribute("open", "");
          }}
          aria-labelledby="schedule-dialog-title"
          onCancel={(event) => { event.preventDefault(); closeDialog(); }}
        >
          <form className="modal-form" onSubmit={(event) => void saveSchedule(event)}>
            <div className="modal-heading">
              <div>
                <h2 id="schedule-dialog-title">{draft.isNew ? "New schedule" : "Edit schedule"}</h2>
                <p className="panel-subtitle">The feeder will receive the complete schedule list.</p>
              </div>
              <button type="button" className="icon-button" onClick={closeDialog} aria-label="Close schedule dialog" disabled={saving}>×</button>
            </div>
            {snapshot.scheduleError ? (
              <StatusBanner tone="error">
                {snapshot.scheduleError}
                {snapshot.scheduleState === "error" ? (
                  <button type="button" className="button button--quiet" disabled={snapshot.clockSyncPending} onClick={() => void store.reloadSchedules()}>
                    Reload schedules
                  </button>
                ) : null}
              </StatusBanner>
            ) : null}
            {errors.length > 0 ? (
              <div className="form-errors" role="alert" id="schedule-errors">
                {errors.map((error) => <p key={error}>{error}</p>)}
              </div>
            ) : null}
            <label className="field" htmlFor="schedule-label">
              <span>Label</span>
              <input
                id="schedule-label"
                name="label"
                type="text"
                autoFocus
                disabled={saving}
                value={form.label}
                onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
                aria-invalid={errors.some((error) => error === "Label is required.")}
                aria-describedby={errors.length > 0 ? "schedule-errors" : undefined}
              />
            </label>
            <label className="field" htmlFor="schedule-time">
              <span>Time</span>
              <input
                id="schedule-time"
                name="time"
                type="time"
                disabled={saving}
                value={form.time}
                onChange={(event) => setForm((current) => ({ ...current, time: event.target.value }))}
                aria-invalid={errors.some((error) => error.startsWith("Time must"))}
                aria-describedby={errors.length > 0 ? "schedule-errors" : undefined}
              />
            </label>
            <fieldset className="field weekday-fieldset" disabled={saving}>
              <legend>Days of the week</legend>
              <div className="day-checkboxes">
                {DAY_LABELS.map((day, index) => (
                  <label key={day}>
                    <input
                      type="checkbox"
                      checked={daysStringToFlags(form.daysOfWeek)[index]}
                      onChange={() => toggleDay(index)}
                    />
                    <span>{day}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="switch-label switch-label--form">
              <input type="checkbox" checked={form.enabled} disabled={saving} onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))} />
              <span>Enabled</span>
            </label>
            <div className="modal-actions">
              <button type="button" className="button button--quiet" onClick={closeDialog} disabled={saving}>Cancel</button>
              <button type="submit" className="button button--primary" disabled={!canEdit}>{saving ? "Saving…" : "Save schedule"}</button>
            </div>
          </form>
        </dialog>
      ) : null}
    </div>
  );
}
