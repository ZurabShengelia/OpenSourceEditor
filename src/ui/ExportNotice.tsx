import { renderStats } from "../app/renderStats";
import { cancelExport, dismissExport, useExportJob } from "../app/exporter";

export function ExportNotice({ error, clearError }: { error: string | null; clearError: () => void }) {
  renderStats.notice++; const job = useExportJob(); const exporting = job.phase === "preparing" || job.phase === "exporting";
  if (!(exporting || job.phase === "failed" || job.phase === "completed" || job.phase === "cancelled" || error)) return null;
  return (
    <div className={`notice ${error || job.phase === "failed" ? "err" : exporting ? "busy" : "ok"}`} role={error || job.phase === "failed" ? "alert" : "status"}>
      {error ? <><span className="grow" title={error}>{error}</span><button className="btn sm ghost" onClick={clearError}>Dismiss</button></>
        : job.phase === "failed" ? <><span className="grow" title={job.error ?? ""}>Export failed: {job.error}</span><button className="btn sm ghost" onClick={dismissExport}>Dismiss</button></>
        : exporting ? <><span>{job.label}</span><div className="bar"><i style={{ width: `${Math.round(job.progress * 100)}%` }} /></div><span className="mono">{job.phase === "preparing" ? "Preparing" : `${Math.round(job.progress * 100)}%`}</span><span className="grow" /><button className="btn sm" onClick={cancelExport}>Cancel</button></>
        : <><span className="grow">{job.label}</span><button className="btn sm ghost" onClick={dismissExport}>Dismiss</button></>}
    </div>
  );
}
