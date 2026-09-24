import { Router, type IRouter } from "express";
import {
  GetDashboardResponse, GetCalendarResponse, GetLeaveResponse, SaveLeaveBody, SaveLeaveResponse,
  UploadRosterBody, UploadRosterResponse, GetRosterSummaryResponse, GetCasesResponse, GetCaseParams,
  GetCaseResponse, GetRulesResponse, SaveRulesBody, SaveRulesResponse, PreviewScheduleBody,
  PreviewScheduleResponse, GetScheduleImpactBody, GetScheduleImpactResponse, PublishScheduleBody,
  PublishScheduleResponse, GetPublicationsResponse,
} from "@workspace/api-zod";
import {
  cases, calendar, getRoster, getRules, getSettings, setState, validateRoster, isWorking, defaults,
  summary, makeSchedule, impact, nextWorking, addDays, today, getState, type Request, type Move,
} from "../lib/planner";

const router: IRouter = Router();
const bad = (res: any, message: string) => res.status(400).json({ error: message });
const dateOk = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;
function movesFit(schedule: Awaited<ReturnType<typeof makeSchedule>>, moves: Move[]) {
  return moves.every(m => schedule.days.some(d => d.date === m.date && d.cases.some(c => c.caseId === m.caseId)));
}

router.get("/dashboard", async (_req, res): Promise<void> => {
  const [rows, settings, rules] = await Promise.all([getRoster(), getSettings(), getRules()]);
  const date = nextWorking(addDays(today(), 1), settings);
  const all = cases(rows, date);
  const preview = await makeSchedule({ period: "day", start_date: date, rules }, rows, settings);
  const chosen = preview.days[0]?.cases || [];
  const lastDate = calendar(settings).at(-1)?.date || addDays(date, 30);
  res.json(GetDashboardResponse.parse({
    nextDate: date, recommendedCount: chosen.length,
    sittingHours: ((Date.parse(`2000-01-01T${settings.morningEnd}:00Z`) - Date.parse(`2000-01-01T${settings.morningStart}:00Z`)) + (Date.parse(`2000-01-01T${settings.afternoonEnd}:00Z`) - Date.parse(`2000-01-01T${settings.afternoonStart}:00Z`))) / 3600000,
    movedForward: chosen.filter(s => s.likelihood !== "Low").length, sentHome: chosen.filter(s => s.likelihood === "Low").length,
    oldCases: all.filter(c => c.ageYears >= 4).length,
    rosterDaysLeft: Math.max(0, Math.round((Date.parse(lastDate) - Date.parse(today())) / 86400000)),
    attention: all.filter(c => c.flags.length).sort((a, b) => b.ageYears - a.ageYears).slice(0, 6),
  }));
});
router.get("/calendar", async (_req, res): Promise<void> => {
  res.json(GetCalendarResponse.parse(calendar(await getSettings())));
});
router.get("/calendar/leave", async (_req, res): Promise<void> => {
  res.json(GetLeaveResponse.parse(await getSettings()));
});
router.post("/calendar/leave", async (req, res): Promise<void> => {
  const parsed = SaveLeaveBody.safeParse(req.body);
  if (!parsed.success) { bad(res, "Please check the leave dates and sitting hours."); return; }
  const x = parsed.data;
  const timeOk = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  if (x.leaveDays.some(d => !dateOk(d)) || [x.morningStart, x.morningEnd, x.afternoonStart, x.afternoonEnd].some(t => !timeOk(t)) || !(x.morningStart < x.morningEnd && x.morningEnd <= x.afternoonStart && x.afternoonStart < x.afternoonEnd)) {
    bad(res, "Use valid dates and make sure sitting hours are in order, with a lunch break."); return;
  }
  res.json(SaveLeaveResponse.parse(await setState("settings", { ...x, leaveDays: [...new Set(x.leaveDays)] })));
});
router.post("/roster/upload", async (req, res): Promise<void> => {
  const parsed = UploadRosterBody.safeParse(req.body);
  if (!parsed.success) { bad(res, "Please choose a CSV roster."); return; }
  try {
    const rows = validateRoster(parsed.data.csv);
    await setState("roster", rows);
    res.json(UploadRosterResponse.parse(summary(cases(rows))));
  } catch (error) {
    bad(res, error instanceof Error ? error.message : "Could not read this CSV.");
  }
});
router.get("/roster/summary", async (_req, res): Promise<void> => {
  res.json(GetRosterSummaryResponse.parse(summary(cases(await getRoster()))));
});
router.get("/cases", async (_req, res): Promise<void> => {
  res.json(GetCasesResponse.parse(cases(await getRoster())));
});
router.get("/cases/:id", async (req, res): Promise<void> => {
  const params = GetCaseParams.safeParse(req.params);
  if (!params.success) { bad(res, "Invalid case number."); return; }
  const item = cases(await getRoster()).find(c => c.id === params.data.id);
  if (!item) { res.status(404).json({ error: "Case not found." }); return; }
  res.json(GetCaseResponse.parse(item));
});
router.get("/rules", async (_req, res): Promise<void> => { res.json(GetRulesResponse.parse(await getRules())); });
router.post("/rules", async (req, res): Promise<void> => {
  const parsed = SaveRulesBody.safeParse(req.body);
  if (!parsed.success) { bad(res, "Review the priorities. At least 25% of time must be reserved for older cases."); return; }
  res.json(SaveRulesResponse.parse(await setState("rules", parsed.data)));
});
router.post("/schedule/preview", async (req, res): Promise<void> => {
  const parsed = PreviewScheduleBody.safeParse(req.body);
  if (!parsed.success || !dateOk(parsed.data?.start_date || "")) { bad(res, "Choose a valid period and start date."); return; }
  const settings = await getSettings();
  const roster = cases(await getRoster(), parsed.data.start_date);
  const moves = parsed.data.moves || [];
  const lastDate = addDays(parsed.data.start_date, parsed.data.period === "day" ? 0 : parsed.data.period === "week" ? 6 : 29);
  if (moves.some(m => !roster.some(c => c.id === m.caseId) || !dateOk(m.date) || m.date < parsed.data.start_date || m.date > lastDate || !isWorking(m.date, settings))) {
    bad(res, "Move cases to a working day within the chosen period."); return;
  }
  const schedule = await makeSchedule(parsed.data as Request, await getRoster(), settings, moves as Move[]);
  if (!movesFit(schedule, moves as Move[])) { bad(res, "A moved case cannot fit or needs process confirmation. Try another sitting day."); return; }
  res.json(PreviewScheduleResponse.parse(schedule));
});
router.post("/schedule/impact", async (req, res): Promise<void> => {
  const parsed = GetScheduleImpactBody.safeParse(req.body);
  if (!parsed.success || !dateOk(parsed.data?.proposed_schedule.start_date || "") || parsed.data.moves.some(m => !dateOk(m.date))) { bad(res, "Please check the proposed schedule and moved cases."); return; }
  const { proposed_schedule, moves } = parsed.data;
  const roster = cases(await getRoster(), proposed_schedule.start_date), ids = new Set(roster.map(c => c.id));
  if (moves.some(m => !ids.has(m.caseId))) { bad(res, "A moved case is not in the current roster."); return; }
  const settings = await getSettings();
  const lastDate = addDays(proposed_schedule.start_date, proposed_schedule.period === "day" ? 0 : proposed_schedule.period === "week" ? 6 : 29);
  if (moves.some(m => m.date < proposed_schedule.start_date || m.date > lastDate || !isWorking(m.date, settings))) { bad(res, "Move cases to a working day within the chosen period."); return; }
  const rows = await getRoster();
  if (!movesFit(await makeSchedule(proposed_schedule as Request, rows, settings, moves as Move[]), moves as Move[])) { bad(res, "A moved case cannot fit or needs process confirmation. Try another sitting day."); return; }
  res.json(GetScheduleImpactResponse.parse(await impact(proposed_schedule as Request, rows, settings, moves as Move[])));
});
router.post("/schedule/publish", async (req, res): Promise<void> => {
  const parsed = PublishScheduleBody.safeParse(req.body);
  if (!parsed.success || !dateOk(parsed.data?.proposed_schedule.start_date || "") || parsed.data.moves.some(m => !dateOk(m.date))) { bad(res, "Please check the schedule before publishing."); return; }
  const { proposed_schedule, moves } = parsed.data;
  const roster = cases(await getRoster(), proposed_schedule.start_date), ids = new Set(roster.map(c => c.id));
  if (moves.some(m => !ids.has(m.caseId))) { bad(res, "A moved case is not in the current roster."); return; }
  const settings = await getSettings();
  const lastDate = addDays(proposed_schedule.start_date, proposed_schedule.period === "day" ? 0 : proposed_schedule.period === "week" ? 6 : 29);
  if (moves.some(m => m.date < proposed_schedule.start_date || m.date > lastDate || !isWorking(m.date, settings))) { bad(res, "Move cases to a working day within the chosen period."); return; }
  const rows = await getRoster();
  const schedule = await makeSchedule(proposed_schedule as Request, rows, settings, moves as Move[]);
  if (!movesFit(schedule, moves as Move[])) { bad(res, "A moved case cannot fit or needs process confirmation. Try another sitting day."); return; }
  const result = PublishScheduleResponse.parse({ id: crypto.randomUUID(), publishedAt: new Date().toISOString(), days: schedule.days });
  const audit = await getAudit();
  const baseline = await makeSchedule({ ...proposed_schedule, rules: defaults } as Request, rows, settings);
  await setState("publications", [...audit, { ...result, moves, recommended: baseline.days }]);
  res.json(result);
});
router.get("/schedule/publications", async (_req, res): Promise<void> => {
  res.json(GetPublicationsResponse.parse(await getAudit()));
});
async function getAudit() { return getState<unknown[]>("publications", []); }
export default router;