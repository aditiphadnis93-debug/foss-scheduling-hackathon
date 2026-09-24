import { Fragment, useMemo, useState } from "react";
import type { Case, ScheduledCase } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Download, ListFilter, Search, Table2 } from "lucide-react";

type CauseListTableProps = {
  date: string;
  cases: ScheduledCase[];
  roster: Case[];
  onSelectCase: (caseItem: ScheduledCase) => void;
};

const text = (value: unknown) => (value === undefined || value === null || value === "" ? "Not available" : String(value));

const csvCell = (value: unknown) => {
  const stringValue = value === undefined || value === null ? "" : String(value);
  const safeValue = /^\s*[=+\-@]/.test(stringValue) ? `'${stringValue}` : stringValue;
  return `"${safeValue.replace(/"/g, '""')}"`;
};

const formatDate = (date: string) => {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? date
    : new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(parsed);
};

const blockLabel = (block: string) => {
  const normalized = block.trim().toLowerCase();
  if (normalized.includes("morning")) return "Morning";
  if (normalized.includes("afternoon")) return "Afternoon";
  return block || "Time block not specified";
};

export default function CauseListTable({ date, cases, roster, onSelectCase }: CauseListTableProps) {
  const [query, setQuery] = useState("");
  const [block, setBlock] = useState("all");
  const [expanded, setExpanded] = useState(false);

  const metadata = useMemo(() => new Map(roster.map((item) => [item.id, item])), [roster]);
  const blocks = useMemo(
    () => Array.from(new Set(cases.map((item) => blockLabel(item.block)))),
    [cases],
  );

  const displayedCases = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return cases
      .filter((item) => block === "all" || blockLabel(item.block) === block)
      .filter((item) => {
        if (!needle) return true;
        const record = metadata.get(item.caseId);
        return [
          item.caseId,
          item.advocateId,
          item.purpose,
          record?.filingNumber,
          record?.partyId,
        ].some((value) => text(value).toLowerCase().includes(needle));
      })
      .sort((a, b) => a.start.localeCompare(b.start));
  }, [block, cases, metadata, query]);

  const exportCsv = () => {
    const header = ["No.", "Case number", "Filing number", "Party ID", "Stage", "Purpose", "Advocate ID", "Date", "Start", "End", "Window", "Block", "Duration (minutes)", "Likelihood"];
    const rows = displayedCases.map((item, index) => {
      const record = metadata.get(item.caseId);
      return [
        index + 1,
        item.caseId,
        record?.filingNumber ?? "",
        record?.partyId ?? "",
        record?.stage ?? "",
        item.purpose,
        item.advocateId,
        item.date,
        item.start,
        item.end,
        item.window,
        item.block,
        item.duration,
        item.likelihood,
      ];
    });
    const csv = `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `cause-list-${date}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="overflow-hidden border-primary/15 shadow-sm" data-testid="cause-list-table">
      <CardHeader className="border-b border-primary/15 bg-primary/5 px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Scheduled cause list</p>
            <CardTitle className="text-xl tracking-tight" data-testid="text-cause-list-date">{formatDate(date)}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Cause list · {displayedCases.length} of {cases.length} listed matters
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setExpanded((value) => !value)} data-testid="button-toggle-cause-list-detail">
              <Table2 className="mr-2 h-4 w-4" />
              {expanded ? "Compact details" : "Expanded details"}
            </Button>
            <Button type="button" size="sm" onClick={exportCsv} disabled={!displayedCases.length} data-testid="button-export-cause-list-csv">
              <Download className="mr-2 h-4 w-4" />
              Export displayed
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2 pt-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search case, filing, party, advocate or purpose"
              className="pl-9"
              aria-label="Search cause list"
              data-testid="input-search-cause-list"
            />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto">
            <ListFilter className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <Button type="button" size="sm" variant={block === "all" ? "secondary" : "outline"} onClick={() => setBlock("all")} data-testid="button-filter-block-all">
              All blocks
            </Button>
            {blocks.map((name) => (
              <Button key={name} type="button" size="sm" variant={block === name ? "secondary" : "outline"} onClick={() => setBlock(name)} data-testid={`button-filter-block-${name.toLowerCase()}`}>
                {name}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {displayedCases.length === 0 ? (
          <div className="px-6 py-12 text-center" data-testid="empty-cause-list-results">
            <p className="font-medium">No listed matters match this view.</p>
            <p className="mt-1 text-sm text-muted-foreground">Try clearing the search or choosing another time block.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm" aria-label={`Cause list for ${date}`}>
              <thead className="bg-primary text-left text-xs uppercase tracking-wider text-primary-foreground">
                <tr>
                  <th scope="col" className="w-14 px-4 py-3 font-semibold">No.</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Case number</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Filing number</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Stage</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Party ID</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Purpose</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Session / time</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Advocate ID</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Likelihood</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Warnings</th>
                  {expanded && <th scope="col" className="px-4 py-3 font-semibold">Why listed / details</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {displayedCases.map((item, index) => {
                  const record = metadata.get(item.caseId);
                  const session = blockLabel(item.block);
                  const newSession = index === 0 || blockLabel(displayedCases[index - 1].block) !== session;
                  return (
                    <Fragment key={`${item.caseId}-${item.start}-${index}`}>
                    {newSession && (
                      <tr className="bg-primary/5">
                        <th scope="rowgroup" colSpan={expanded ? 11 : 10} className="border-y border-primary/10 px-4 py-2 text-center text-xs font-bold uppercase tracking-wider text-primary">{session} sitting</th>
                      </tr>
                    )}
                    <tr className="transition-colors hover:bg-muted/20" data-testid={`row-cause-${item.caseId}`}>
                      <td className="px-4 py-3 align-top font-mono text-xs text-muted-foreground">{index + 1}</td>
                      <td className="px-4 py-3 align-top">
                        <button type="button" onClick={() => onSelectCase(item)} className="text-left font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid={`button-select-case-${item.caseId}`}>
                          {item.caseId}
                        </button>
                      </td>
                      <td className="px-4 py-3 align-top font-mono text-xs">{text(record?.filingNumber)}</td>
                      <td className="px-4 py-3 align-top">{text(record?.stage)}</td>
                      <td className="px-4 py-3 align-top font-mono text-xs">{text(record?.partyId)}</td>
                      <td className="max-w-[220px] px-4 py-3 align-top text-foreground">{text(item.purpose)}</td>
                      <td className="whitespace-nowrap px-4 py-3 align-top">
                        <span className="font-medium">{item.start} – {item.end}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">{blockLabel(item.block)} · {item.duration} min</span>
                      </td>
                      <td className="px-4 py-3 align-top font-mono text-xs">{text(item.advocateId)}</td>
                      <td className="px-4 py-3 align-top"><Badge variant={item.likelihood === "High" ? "default" : "secondary"}>{item.likelihood}</Badge></td>
                      <td className="px-4 py-3 align-top">
                        {item.defects?.length ? (
                          <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-300">{item.defects.length} warning{item.defects.length === 1 ? "" : "s"}</Badge>
                        ) : <span className="text-xs text-muted-foreground">None recorded</span>}
                      </td>
                      {expanded && (
                        <td className="min-w-[260px] px-4 py-3 align-top text-xs text-muted-foreground">
                          <div className="space-y-2">
                            <div>
                              <span className="font-medium text-foreground">Reasons</span>
                              {item.reasons.length ? (
                                <ul className="mt-1 list-disc space-y-1 pl-4">
                                  {item.reasons.map((reason, reasonIndex) => <li key={`${reason.code}-${reasonIndex}`}>{reason.detail || reason.code}</li>)}
                                </ul>
                              ) : <p className="mt-1">Not recorded</p>}
                            </div>
                            <div>
                              <span className="font-medium text-foreground">Warnings</span>
                              {item.defects?.length ? (
                                <ul className="mt-1 list-disc space-y-1 pl-4">
                                  {item.defects.map((defect, defectIndex) => <li key={`${defect.code}-${defectIndex}`}>{defect.evidence || defect.code}</li>)}
                                </ul>
                              ) : <p className="mt-1">None recorded</p>}
                            </div>
                          </div>
                        </td>
                      )}
                    </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}