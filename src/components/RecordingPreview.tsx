import { useEffect, useState, type CSSProperties, type RefObject } from "react";
import { Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from "lucide-react";

function clock(value: number) {
  const seconds = Math.max(0, Math.floor(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function RecordingPreview({ audioRef, source, onDuration }: {
  audioRef: RefObject<HTMLAudioElement>;
  source: string;
  onDuration: (duration: number) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const ready = duration > 0;
  useEffect(() => { setPlaying(false); setPosition(0); setDuration(0); setError(""); }, [source]);

  function seek(value: number) {
    if (!audioRef.current || !ready) return;
    audioRef.current.currentTime = Math.max(0, Math.min(duration, value));
    setPosition(audioRef.current.currentTime);
  }
  async function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) { audio.pause(); return; }
    if (audio.ended) seek(0);
    setError("");
    try { await audio.play(); }
    catch { setError("Could not play this recording. You can still transcribe it."); }
  }

  return <div className="recording-preview">
    <audio ref={audioRef} src={source} preload="metadata" hidden
      onLoadedMetadata={event => { const value = event.currentTarget.duration; if (Number.isFinite(value) && value > 0) { setDuration(value); onDuration(value); } }}
      onTimeUpdate={event => setPosition(event.currentTarget.currentTime)}
      onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
      onVolumeChange={event => { setVolume(event.currentTarget.volume); setMuted(event.currentTarget.muted); }}
      onError={() => { setPlaying(false); setError("Could not load the audio preview. You can still transcribe this recording."); }} />
    <div className="recording-preview-bar" role="group" aria-label="Recording playback">
      <button type="button" className="recording-preview-play" aria-label={playing ? "Pause preview" : "Play preview"} disabled={!ready} onClick={() => void toggle()}>{playing ? <Pause size={18} fill="currentColor"/> : <Play size={18} fill="currentColor"/>}</button>
      <button type="button" className="recording-preview-skip" aria-label="Back 15 seconds" title="Back 15 seconds" disabled={!ready} onClick={() => seek(position - 15)}><RotateCcw size={18}/></button>
      <div className="recording-preview-timeline">
        <input className="recording-preview-range" type="range" aria-label="Seek recording" aria-valuetext={`${clock(position)} of ${clock(duration)}`} min={0} max={duration || 0} step={0.1} value={Math.min(position, duration)} disabled={!ready} onChange={event => seek(Number(event.target.value))} style={{ "--played": `${ready ? position / duration * 100 : 0}%` } as CSSProperties}/>
        <div className="recording-preview-times"><span>{clock(position)}</span><span>{clock(duration)}</span></div>
      </div>
      <button type="button" className="recording-preview-skip" aria-label="Forward 15 seconds" title="Forward 15 seconds" disabled={!ready} onClick={() => seek(position + 15)}><RotateCw size={18}/></button>
      <button type="button" className="recording-preview-volume" aria-label={muted || volume === 0 ? "Unmute preview" : "Mute preview"} onClick={() => { if (audioRef.current) { if (volume === 0) { audioRef.current.volume = .5; audioRef.current.muted = false; } else audioRef.current.muted = !muted; } }}>{muted || volume === 0 ? <VolumeX size={18}/> : <Volume2 size={18}/>}</button>
      <input className="recording-preview-range recording-preview-volume-range" type="range" aria-label="Preview volume" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={event => { if (audioRef.current) { audioRef.current.volume = Number(event.target.value); audioRef.current.muted = false; } }} style={{ "--played": `${muted ? 0 : volume * 100}%` } as CSSProperties}/>
    </div>
    {error && <p className="recorder-error" role="alert">{error}</p>}
  </div>;
}
