import { useState } from "react";
import { useFeederSnapshot, useFeederStore } from "@/state/feeder-context";
import { StatusBanner } from "./StatusBanner";

const PWM_SCALE = 10.23;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function motorLabel(motorState: string | undefined): string {
  const labels: Record<string, string> = {
    pre_spin: "Getting ready…",
    feeding: "Feeding…",
    post_spin: "Finishing up…",
    jam_clear: "Unclogging…",
  };
  return labels[motorState ?? ""] ?? "Idle";
}

export function ControlsView() {
  const snapshot = useFeederSnapshot();
  const store = useFeederStore();
  const [augerSpeed, setAugerSpeed] = useState(75);
  const [impellerSpeed, setImpellerSpeed] = useState(100);
  const [feedDuration, setFeedDuration] = useState(3);
  const [confirmClearJam, setConfirmClearJam] = useState(false);
  const isFeeding = snapshot.deviceData.motorState !== undefined && snapshot.deviceData.motorState !== "idle";
  const disabled = !snapshot.isConnected || isFeeding;

  function updateSpeed(setter: (value: number) => void, value: string): void {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) setter(clamp(parsed, 0, 100));
  }

  function updateDuration(value: string): void {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) setFeedDuration(clamp(parsed, 0, 30));
  }

  function sendFeed(): void {
    if (!snapshot.isConnected || isFeeding) return;
    void store.startFeed({
      augerSpeed: Math.round(augerSpeed * PWM_SCALE),
      impellerSpeed: Math.round(impellerSpeed * PWM_SCALE),
      preSpinMs: 1500,
      feedMs: Math.round(feedDuration * 1000),
      postSpinMs: 1500,
    });
  }

  function sendClearJam(): void {
    setConfirmClearJam(false);
    void store.clearJam();
  }

  return (
    <div className="view-stack">
      {!snapshot.isConnected ? (
        <StatusBanner tone="warning">Disconnected — controls are unavailable.</StatusBanner>
      ) : null}
      {snapshot.lastCommandError ? <StatusBanner tone="error">{snapshot.lastCommandError}</StatusBanner> : null}
      {isFeeding ? <StatusBanner tone="info">{motorLabel(snapshot.deviceData.motorState)}</StatusBanner> : null}

      <section className="panel control-panel" aria-labelledby="speed-heading">
        <div className="panel-heading">
          <div>
            <h2 id="speed-heading">Motor settings</h2>
            <p className="panel-subtitle">Choose the output before starting a feed.</p>
          </div>
        </div>
        <div className="control-grid">
          <label className="field field--range">
            <span>Feed speed</span>
            <div className="range-line">
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={augerSpeed}
                onChange={(event) => updateSpeed(setAugerSpeed, event.target.value)}
                disabled={disabled}
                aria-label="Feed speed"
              />
              <output>{augerSpeed}%</output>
            </div>
          </label>
          <label className="field field--range">
            <span>Spread speed</span>
            <div className="range-line">
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={impellerSpeed}
                onChange={(event) => updateSpeed(setImpellerSpeed, event.target.value)}
                disabled={disabled}
                aria-label="Spread speed"
              />
              <output>{impellerSpeed}%</output>
            </div>
          </label>
          <label className="field">
            <span>Feed duration</span>
            <div className="input-with-unit">
              <input
                type="number"
                min="0"
                max="30"
                step="0.1"
                inputMode="decimal"
                value={feedDuration}
                onChange={(event) => updateDuration(event.target.value)}
                disabled={disabled}
                aria-label="Feed duration"
                aria-describedby="duration-help"
              />
              <span aria-hidden="true">seconds</span>
            </div>
            <span id="duration-help" className="field-help">Maximum 30 seconds.</span>
          </label>
        </div>
      </section>

      <section className="action-row" aria-label="Feed actions">
        <button type="button" className="button button--primary button--large" onClick={sendFeed} disabled={!snapshot.isConnected || isFeeding}>
          FEED
        </button>
        {isFeeding ? (
          <button type="button" className="button button--danger button--large" onClick={() => void store.stopFeed()}>
            STOP
          </button>
        ) : null}
        {!confirmClearJam ? (
          <button
            type="button"
            className="button button--warning button--large"
            onClick={() => setConfirmClearJam(true)}
            disabled={!snapshot.isConnected}
          >
            CLEAR JAM
          </button>
        ) : (
          <div className="confirm-box" role="group" aria-label="Confirm clear jam">
            <span>Run the unclog sequence?</span>
            <button type="button" className="button button--warning" onClick={sendClearJam}>Confirm clear jam</button>
            <button type="button" className="button button--quiet" onClick={() => setConfirmClearJam(false)}>Cancel</button>
          </div>
        )}
      </section>
    </div>
  );
}
