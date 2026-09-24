// The tournament's pick, frozen as data (written by scripts/experiments/freeze-winner.ts from
// out/tournament/winner.json; test/benchtime-final.test.ts checks they still match). Registered as the
// policy "benchtime_final" in src/planner/index.ts; "benchtime" stays the overnight build.

import type { Genome } from "./genome";

export const BENCHTIME_FINAL_SOURCE = {
  "name": "g237",
  "origin": "archive g237",
  "criteria": "final rule, 14:15 (after adversarial review)",
  "failedDecide": 0,
  "failedConfirm": 1,
  "frozenFrom": "out/tournament/winner.json",
  "frozenAt": "2026-09-24T09:25:53.619Z"
} as const;

export const BENCHTIME_FINAL_GENOME: Genome = {
  "selection": "index",
  "firstDates": "spread",
  "nextDate": "earliest",
  "coverage": "rotation",
  "callOrder": "cluster",
  "calibration": "off",
  "caseEstimate": true,
  "priorCheck": true,
  "desk": true,
  "checkin": false,
  "checkinRobust": false,
  "cluster": true,
  "callTimes": false,
  "fillTarget": 1.105,
  "standbyShare": 0.3,
  "promiseFill": 1.204,
  "initialFill": 0.95,
  "firstOldShare": 0.209,
  "weights": {
    "throughput": 1.643,
    "disposal": 1.622,
    "fairness": 2.619,
    "trips": 1.883,
    "predictability": 3
  },
  "ageExponent": 0.802,
  "ageingFloor": 0.33,
  "enforceFloor": true,
  "windowDays": 5,
  "relistDays": 11,
  "relistCap": 1.045,
  "quickRelist": true,
  "gapOfHeard": true,
  "countDiary": false,
  "countCap": 85,
  "pendingHold": 0.44,
  "returnMargin": 1.376,
  "recheckDays": 12,
  "rotationDays": 45,
  "rotationCap": 0.34,
  "reviewDays": 11,
  "mentionAfter": 0,
  "portfolioOld": 0.191,
  "blocks": "none",
  "purposeDays": false,
  "carryForward": false,
  "rotationAll": false
};
