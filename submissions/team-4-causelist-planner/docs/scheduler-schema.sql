-- Scheduler subset of the High Court domain model: DuckDB DDL (23 tables + 2 views).
-- This is what the scheduling tool actually needs. The full 72-table reference is court-schema.sql;
-- see docs/court-domain-model.md §12 for the tiers and the merges applied here.
--
-- Column names match court-schema.sql, so the subset can grow into the full model without renames.
-- Differences from the full model:
--   * reference tables (case_type, case_stage, subject_category, disposal_nature) are plain columns, not FKs;
--   * individual / organisation are dropped: names live on party, advocate and judge;
--   * compliance_deadline is folded into task (task_type 'document.submission' + due_date);
--   * judgment is folded into court_order (order_type_code 'judgment');
--   * custody_status is the court_case.is_in_custody flag;
--   * denormalised stand-ins for dropped tables (the only columns not in the full model):
--     judge.name, advocate.name/mobile_number/email, party.mobile_number/email (from individual),
--     court_hall.tenant_id/establishment (from court_establishment),
--     party.person_key (stands in for individual/organisation identity, so one litigant spans cases);
--   * bench is optional: causelist carries judge_id, bench_id is kept only for DRISTI compatibility;
--   * causelist is unique per scheduling run, so several draft schedules for one day can coexist
--     (the full model has one list per bench, date and list type).
-- The app's working copy (data/court.duckdb) is built from this file by datagen/schema.py.

-- =====================================================================
-- C. Calendar views: who and where
-- =====================================================================

CREATE TABLE judge (
    id                  VARCHAR PRIMARY KEY,          -- DRISTI judgeId
    tenant_id           VARCHAR NOT NULL,             -- the High Court
    name                VARCHAR NOT NULL,
    designation         VARCHAR NOT NULL DEFAULT 'judge',
    additional_details  JSON
);

CREATE TABLE court_hall (
    id                  VARCHAR PRIMARY KEY,
    tenant_id           VARCHAR NOT NULL,
    establishment       VARCHAR,                      -- principal seat / bench name
    hall_number         VARCHAR NOT NULL,
    vc_enabled          BOOLEAN DEFAULT FALSE,
    additional_details  JSON
);

-- =====================================================================
-- A. Scheduler core: reference tables
-- =====================================================================

-- Purpose of hearing (scheduler/data.py HEARING_TYPES + NEXT_PURPOSE).
CREATE TABLE hearing_type (
    code                VARCHAR PRIMARY KEY,
    name                VARCHAR NOT NULL,
    priority            INTEGER NOT NULL,
    est_minutes         INTEGER NOT NULL,
    p_heard             DOUBLE,
    p_effective         DOUBLE,
    ideal_gap_days      INTEGER,
    min_gap_days        INTEGER,
    next_purpose_code   VARCHAR,                      -- NULL = an effective hearing disposes of the case
    list_section        VARCHAR,
    additional_details  JSON
);

-- Hearing-failure taxonomy (docs/court-domain-model.md §6).
CREATE TABLE adjournment_reason (
    code                VARCHAR PRIMARY KEY,
    name                VARCHAR NOT NULL,
    failure_kind        VARCHAR NOT NULL CHECK (failure_kind IN ('not_heard', 'heard_not_effective')),
    attributable_to     VARCHAR NOT NULL CHECK (attributable_to IN ('party', 'advocate', 'court', 'state_agency', 'external')),
    preventable_by_scheduler BOOLEAN,
    additional_details  JSON
);

CREATE TABLE advocate (
    id                       VARCHAR PRIMARY KEY,
    tenant_id                VARCHAR,
    name                     VARCHAR NOT NULL,
    bar_registration_number  VARCHAR,
    designation              VARCHAR NOT NULL DEFAULT 'advocate' CHECK (designation IN ('advocate', 'senior_advocate')),
    mobile_number            VARCHAR,                 -- calendar invites / reminders
    email                    VARCHAR,
    additional_details       JSON
);

-- =====================================================================
-- A. Scheduler core: the case
-- =====================================================================

CREATE TABLE court_case (
    id                  VARCHAR PRIMARY KEY,
    tenant_id           VARCHAR NOT NULL,
    filing_number       VARCHAR NOT NULL UNIQUE,
    filing_date         DATE NOT NULL,                -- case age is measured from here
    registration_date   DATE,
    cnr_number          VARCHAR UNIQUE,
    court_case_number   VARCHAR,                      -- display form, e.g. 'WP(C) 1234/2024'
    case_title          VARCHAR,
    case_type_code      VARCHAR,                      -- plain column here (FK in the full model)
    nature              VARCHAR CHECK (nature IN ('civil', 'criminal')),
    stage_code          VARCHAR,
    sub_stage_code      VARCHAR,
    status              VARCHAR NOT NULL DEFAULT 'pending' CHECK (status IN (
                            'registered', 'pending', 'judgment_reserved', 'disposed', 'sine_die', 'stayed', 'transferred')),
    disposal_nature_code VARCHAR,
    disposal_date       DATE,
    judge_id            VARCHAR REFERENCES judge (id),
    bench_id            VARCHAR,                      -- optional; DRISTI benchId
    is_part_heard       BOOLEAN DEFAULT FALSE,
    -- priority flags
    is_urgent           BOOLEAN DEFAULT FALSE,
    is_senior_citizen   BOOLEAN DEFAULT FALSE,
    is_in_custody       BOOLEAN DEFAULT FALSE,
    is_legal_aid        BOOLEAN DEFAULT FALSE,
    is_on_hold          BOOLEAN DEFAULT FALSE,
    -- listing state
    next_hearing_date   DATE,
    next_purpose_code   VARCHAR REFERENCES hearing_type (code),
    last_listed_date    DATE,
    last_heard_date     DATE,
    adjournment_count   INTEGER DEFAULT 0,
    consecutive_skips   INTEGER DEFAULT 0,
    additional_details  JSON
);

-- Litigants (calendar tier C). A litigant is a party on a case, not a separate person table.
CREATE TABLE party (
    id                  VARCHAR PRIMARY KEY,
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    party_category      VARCHAR NOT NULL DEFAULT 'individual' CHECK (party_category IN ('individual', 'organisation')),
    party_type          VARCHAR NOT NULL,             -- petitioner | respondent | appellant | accused | state ...
    party_number        VARCHAR,                      -- 'P1', 'R3'
    name                VARCHAR NOT NULL,
    person_key          VARCHAR,                      -- same person / organisation across cases
    is_party_in_person  BOOLEAN DEFAULT FALSE,
    is_state            BOOLEAN DEFAULT FALSE,
    mobile_number       VARCHAR,
    email               VARCHAR,
    is_active           BOOLEAN DEFAULT TRUE,
    additional_details  JSON
);

CREATE TABLE advocate_mapping (
    id                  VARCHAR PRIMARY KEY,
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    advocate_id         VARCHAR NOT NULL REFERENCES advocate (id),
    party_id            VARCHAR REFERENCES party (id),
    advocate_type       VARCHAR NOT NULL DEFAULT 'primary' CHECK (advocate_type IN ('primary', 'support', 'senior_briefed')),
    is_active           BOOLEAN DEFAULT TRUE,
    additional_details  JSON
);

-- =====================================================================
-- A. Scheduler core: calendar and the judge's style
-- =====================================================================

CREATE TABLE court_calendar (
    id                  VARCHAR PRIMARY KEY,
    tenant_id           VARCHAR NOT NULL,
    day                 DATE NOT NULL,
    day_type            VARCHAR NOT NULL CHECK (day_type IN (
                            'holiday', 'restricted_holiday', 'vacation', 'vacation_sitting',
                            'working_saturday', 'half_day', 'no_sitting')),
    description         VARCHAR,
    additional_details  JSON
);

CREATE TABLE judge_leave (
    id                  VARCHAR PRIMARY KEY,
    judge_id            VARCHAR NOT NULL REFERENCES judge (id),
    from_date           DATE NOT NULL,
    to_date             DATE NOT NULL,
    session             VARCHAR DEFAULT 'full_day' CHECK (session IN ('full_day', 'forenoon', 'afternoon')),
    additional_details  JSON
);

-- presets/*.yaml as data. Locked rules are NOT columns: they stay constants in scheduler/config.py.
CREATE TABLE scheduling_preset (
    id                  VARCHAR PRIMARY KEY,
    judge_id            VARCHAR REFERENCES judge (id),
    court_hall_id       VARCHAR REFERENCES court_hall (id),
    name                VARCHAR NOT NULL,
    max_cases_per_day   INTEGER NOT NULL DEFAULT 60,
    listing_factor      DOUBLE NOT NULL DEFAULT 1.0,
    clustering          BOOLEAN DEFAULT FALSE,
    rollover            BOOLEAN DEFAULT FALSE,
    case_type_codes     VARCHAR[],
    weights             JSON,
    requires_cover_page_for VARCHAR[],                -- hearing types that get a case summary first (Dimakar)
    source_yaml         VARCHAR,
    additional_details  JSON
);

CREATE TABLE time_block (
    id                  VARCHAR PRIMARY KEY,
    preset_id           VARCHAR NOT NULL REFERENCES scheduling_preset (id),
    name                VARCHAR NOT NULL,
    start_time          TIME NOT NULL,
    end_time            TIME NOT NULL,
    purpose_codes       VARCHAR[] NOT NULL,
    weekdays            INTEGER[] NOT NULL,           -- Mon=0
    sort_by             VARCHAR NOT NULL DEFAULT 'score' CHECK (sort_by IN ('score', 'age', 'newest')),
    additional_details  JSON
);

-- =====================================================================
-- A. Scheduler core: runs and output
-- =====================================================================

CREATE TABLE scheduling_run (
    id                  VARCHAR PRIMARY KEY,
    preset_id           VARCHAR NOT NULL REFERENCES scheduling_preset (id),
    run_at              TIMESTAMP NOT NULL,
    horizon_start       DATE NOT NULL,
    horizon_days        INTEGER NOT NULL,
    policy              VARCHAR NOT NULL,             -- l1 | l2 | l3 | baseline
    data_version        VARCHAR,
    seed                INTEGER,
    code_version        VARCHAR,
    clamped_rules       VARCHAR[],
    metrics             JSON,
    additional_details  JSON
);

CREATE TABLE causelist (
    id                  VARCHAR PRIMARY KEY,
    tenant_id           VARCHAR NOT NULL,
    judge_id            VARCHAR NOT NULL REFERENCES judge (id),
    bench_id            VARCHAR,
    court_hall_id       VARCHAR REFERENCES court_hall (id),
    list_date           DATE NOT NULL,
    list_type           VARCHAR NOT NULL DEFAULT 'daily' CHECK (list_type IN ('daily', 'supplementary', 'advance', 'weekly', 'vacation', 'special')),
    scheduling_run_id   VARCHAR REFERENCES scheduling_run (id),
    status              VARCHAR NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'published', 'revised')),
    published_at        TIMESTAMP,
    additional_details  JSON,
    UNIQUE (judge_id, list_date, list_type, scheduling_run_id)
);

CREATE TABLE causelist_item (
    id                  VARCHAR PRIMARY KEY,
    causelist_id        VARCHAR NOT NULL REFERENCES causelist (id),
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    serial_number       INTEGER NOT NULL,
    list_section        VARCHAR,
    purpose_code        VARCHAR NOT NULL REFERENCES hearing_type (code),
    tag_group           VARCHAR,
    time_block          VARCHAR,
    window_start        TIMESTAMP,
    window_end          TIMESTAMP,
    expected_minutes    DOUBLE,
    score               DOUBLE,
    reasons             VARCHAR[],                    -- the why-trail
    was_booked          BOOLEAN DEFAULT FALSE,
    additional_details  JSON
);

CREATE TABLE listing_decision (
    id                  VARCHAR PRIMARY KEY,
    run_id              VARCHAR NOT NULL REFERENCES scheduling_run (id),
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    list_date           DATE NOT NULL,
    decision            VARCHAR NOT NULL CHECK (decision IN ('listed', 'forced', 'near_miss', 'excluded', 'not_ranked')),
    time_block          VARCHAR,
    score               DOUBLE,
    score_components    JSON,
    exclusion_reason    VARCHAR,
    reasons             VARCHAR[],
    causelist_item_id   VARCHAR REFERENCES causelist_item (id),
    additional_details  JSON
);

-- =====================================================================
-- B. Outcomes, insights and the case timeline
-- =====================================================================

CREATE TABLE hearing (
    id                  VARCHAR PRIMARY KEY,
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    causelist_item_id   VARCHAR REFERENCES causelist_item (id),
    hearing_type_code   VARCHAR NOT NULL REFERENCES hearing_type (code),
    status              VARCHAR NOT NULL CHECK (status IN ('scheduled', 'in_progress', 'in_transcription', 'adjourned', 'closed', 'cancelled')),
    judge_id            VARCHAR REFERENCES judge (id),
    court_hall_id       VARCHAR REFERENCES court_hall (id),
    hearing_date        DATE NOT NULL,
    start_time          TIMESTAMP,
    end_time            TIMESTAMP,
    mode                VARCHAR CHECK (mode IN ('physical', 'virtual', 'hybrid')),
    notes               VARCHAR,
    additional_details  JSON
);

CREATE TABLE hearing_outcome (
    hearing_id          VARCHAR PRIMARY KEY REFERENCES hearing (id),
    was_reached         BOOLEAN NOT NULL,
    was_heard           BOOLEAN NOT NULL,
    was_effective       BOOLEAN NOT NULL,
    actual_minutes      DOUBLE,
    within_window       BOOLEAN,
    stage_before_code   VARCHAR,
    stage_after_code    VARCHAR,
    next_hearing_date   DATE,
    next_purpose_code   VARCHAR REFERENCES hearing_type (code),
    next_date_source    VARCHAR CHECK (next_date_source IN ('scheduler', 'judge', 'rollover', 'default', 'not_fixed')),
    additional_details  JSON
);

CREATE TABLE adjournment (
    id                  VARCHAR PRIMARY KEY,
    hearing_id          VARCHAR NOT NULL REFERENCES hearing (id),
    reason_code         VARCHAR NOT NULL REFERENCES adjournment_reason (code),
    sought_by_party_id  VARCHAR REFERENCES party (id),
    sought_by_advocate_id VARCHAR REFERENCES advocate (id),
    is_last_opportunity BOOLEAN DEFAULT FALSE,
    remarks             VARCHAR,
    additional_details  JSON
);

-- Interim applications: filed and decided dates feed the timeline; pending urgent IAs raise priority.
CREATE TABLE application (
    id                  VARCHAR PRIMARY KEY,
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    application_number  VARCHAR NOT NULL,
    application_type_code VARCHAR NOT NULL,           -- stay | condonation_of_delay | bail | amendment ... (plain column here)
    created_date        DATE NOT NULL,
    filed_by_party_id   VARCHAR REFERENCES party (id),
    status              VARCHAR NOT NULL,             -- pending | allowed | dismissed | withdrawn | closed
    decided_on          DATE,
    is_urgent           BOOLEAN DEFAULT FALSE,
    additional_details  JSON
);

-- Orders, including judgments (order_type_code 'judgment'). `summary` is the one-line gist for the timeline.
CREATE TABLE court_order (
    id                  VARCHAR PRIMARY KEY,
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    order_number        VARCHAR NOT NULL,
    hearing_id          VARCHAR REFERENCES hearing (id),
    application_id      VARCHAR REFERENCES application (id),
    order_type_code     VARCHAR NOT NULL,             -- notice | interim_stay | adjournment | directions | disposal | judgment ...
    order_date          DATE NOT NULL,
    summary             VARCHAR,                      -- 'Notice to R2 by speed post; counter in 4 weeks'
    order_text          VARCHAR,                      -- full text, if available (input to optional local-LLM summaries)
    document_uri        VARCHAR,
    additional_details  JSON
);

-- Process and deadlines. An open task that blocks the next purpose = prerequisite pending.
CREATE TABLE task (
    id                  VARCHAR PRIMARY KEY,
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    order_id            VARCHAR REFERENCES court_order (id),
    task_type           VARCHAR NOT NULL,             -- DRISTI: summons | notice | warrant | document.submission (counter, rejoinder, records) ...
    task_description    VARCHAR,
    addressee_party_id  VARCHAR REFERENCES party (id),
    responsible_advocate_id VARCHAR REFERENCES advocate (id),
    service_mode        VARCHAR,
    created_date        DATE NOT NULL,
    due_date            DATE,
    service_status      VARCHAR NOT NULL DEFAULT 'pending' CHECK (service_status IN (
                            'pending', 'dispatched', 'served', 'complied', 'refused', 'unserved', 'returned', 'cancelled')),
    served_on           DATE,                         -- served, or complied with for document.submission
    blocks_hearing_type VARCHAR REFERENCES hearing_type (code),  -- NULL = blocks any purpose
    additional_details  JSON
);

CREATE TABLE case_stage_history (
    id                  VARCHAR PRIMARY KEY,
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    from_stage_code     VARCHAR,
    to_stage_code       VARCHAR NOT NULL,
    changed_on          DATE NOT NULL,
    hearing_id          VARCHAR REFERENCES hearing (id),
    additional_details  JSON
);

-- =====================================================================
-- Views
-- =====================================================================

-- One row per event in a case's life, oldest first. The judge-facing timeline (doc §12).
CREATE VIEW case_timeline AS
WITH reasons AS (
    SELECT a.hearing_id, string_agg(r.name, ', ' ORDER BY r.name) AS reasons
    FROM adjournment a JOIN adjournment_reason r ON r.code = a.reason_code
    GROUP BY a.hearing_id
)
SELECT id AS case_id, filing_date AS event_date, 1 AS seq, 'filed' AS event_type,
       'Filed' AS title, filing_number AS detail, 'court_case' AS source_table, id AS source_id
FROM court_case
UNION ALL
SELECT id, registration_date, 2, 'registered',
       'Registered as ' || coalesce(court_case_number, '?'), cnr_number, 'court_case', id
FROM court_case WHERE registration_date IS NOT NULL
UNION ALL
SELECT case_id, changed_on, 3, 'stage_change',
       'Stage: ' || coalesce(from_stage_code, '—') || ' → ' || to_stage_code, NULL, 'case_stage_history', id
FROM case_stage_history
UNION ALL
SELECT h.case_id, h.hearing_date, 4,
       CASE WHEN o.was_effective THEN 'hearing_effective'
            WHEN o.was_heard THEN 'hearing_not_effective'
            WHEN o.hearing_id IS NOT NULL THEN 'hearing_not_heard'
            ELSE 'hearing_' || h.status END,
       replace(h.hearing_type_code, '_', ' ') || ': ' ||
       CASE WHEN o.was_effective THEN 'effective'
            WHEN o.was_heard THEN 'heard, not effective'
            WHEN o.hearing_id IS NOT NULL THEN 'not heard'
            ELSE h.status END,
       concat_ws('; ', r.reasons,
                 CASE WHEN o.next_hearing_date IS NOT NULL
                      THEN 'next ' || strftime(o.next_hearing_date, '%d %b %Y') || coalesce(' for ' || replace(o.next_purpose_code, '_', ' '), '') END),
       'hearing', h.id
FROM hearing h
LEFT JOIN hearing_outcome o ON o.hearing_id = h.id
LEFT JOIN reasons r ON r.hearing_id = h.id
UNION ALL
SELECT case_id, order_date, 5, 'order',
       'Order: ' || replace(order_type_code, '_', ' '), summary, 'court_order', id
FROM court_order
UNION ALL
SELECT case_id, created_date, 6, 'application_filed',
       'IA filed: ' || replace(application_type_code, '_', ' '), application_number, 'application', id
FROM application
UNION ALL
SELECT case_id, decided_on, 7, 'application_decided',
       'IA ' || status || ': ' || replace(application_type_code, '_', ' '), application_number, 'application', id
FROM application WHERE decided_on IS NOT NULL
UNION ALL
SELECT case_id, created_date, 8, 'task_issued',
       replace(task_type, '.', ' ') || ' issued', task_description, 'task', id
FROM task
UNION ALL
SELECT case_id, served_on, 9, 'task_done',
       replace(task_type, '.', ' ') || ' ' || service_status, task_description, 'task', id
FROM task WHERE served_on IS NOT NULL
UNION ALL
SELECT id, disposal_date, 10, 'disposed',
       'Disposed: ' || coalesce(disposal_nature_code, '?'), NULL, 'court_case', id
FROM court_case WHERE disposal_date IS NOT NULL;

-- One row per case: the facts the templated summary / cover page is written from (doc §12).
CREATE VIEW case_summary_facts AS
WITH h AS (
    SELECT h.case_id,
           count(*)                                          AS hearings,
           count(*) FILTER (WHERE o.was_heard)               AS heard,
           count(*) FILTER (WHERE o.was_effective)           AS effective,
           count(*) FILTER (WHERE o.hearing_id IS NOT NULL AND NOT o.was_heard) AS not_heard,
           max(h.hearing_date) FILTER (WHERE o.was_effective) AS last_effective_date,
           arg_max(h.hearing_type_code, h.hearing_date) FILTER (WHERE o.was_effective) AS last_effective_purpose
    FROM hearing h LEFT JOIN hearing_outcome o ON o.hearing_id = h.id
    GROUP BY h.case_id
),
top_reason AS (
    SELECT case_id, arg_max(name, n) AS top_adjournment_reason, max(n) AS top_adjournment_count
    FROM (SELECT h.case_id, r.name, count(*) AS n
          FROM adjournment a JOIN hearing h ON h.id = a.hearing_id
          JOIN adjournment_reason r ON r.code = a.reason_code
          GROUP BY h.case_id, r.name)
    GROUP BY case_id
),
stage AS (
    SELECT case_id, max(changed_on) AS stage_since FROM case_stage_history GROUP BY case_id
),
open_tasks AS (
    SELECT case_id, count(*) AS open_tasks, min(created_date) AS oldest_open_task,
           string_agg(coalesce(task_description, task_type), '; ' ORDER BY created_date) AS open_task_list
    FROM task WHERE service_status IN ('pending', 'dispatched', 'unserved', 'returned')
    GROUP BY case_id
),
ias AS (
    SELECT case_id, count(*) AS pending_ias FROM application WHERE status = 'pending' GROUP BY case_id
),
last_order AS (
    SELECT case_id, arg_max(summary, order_date) AS last_order_summary, max(order_date) AS last_order_date
    FROM court_order GROUP BY case_id
)
SELECT c.id AS case_id, c.court_case_number, c.case_title, c.filing_date,
       round(date_diff('day', c.filing_date, current_date) / 365.25, 1) AS age_years,
       c.stage_code, s.stage_since, c.next_hearing_date, c.next_purpose_code,
       coalesce(h.hearings, 0) AS hearings, coalesce(h.heard, 0) AS heard,
       coalesce(h.effective, 0) AS effective, coalesce(h.not_heard, 0) AS not_heard,
       h.last_effective_date, h.last_effective_purpose,
       t.top_adjournment_reason, t.top_adjournment_count,
       coalesce(ot.open_tasks, 0) AS open_tasks, ot.oldest_open_task, ot.open_task_list,
       coalesce(i.pending_ias, 0) AS pending_ias,
       lo.last_order_date, lo.last_order_summary
FROM court_case c
LEFT JOIN h ON h.case_id = c.id
LEFT JOIN top_reason t ON t.case_id = c.id
LEFT JOIN stage s ON s.case_id = c.id
LEFT JOIN open_tasks ot ON ot.case_id = c.id
LEFT JOIN ias i ON i.case_id = c.id
LEFT JOIN last_order lo ON lo.case_id = c.id;
