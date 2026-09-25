-- High Court domain model: DuckDB DDL.
-- Companion to docs/court-domain-model.md; each block names the doc section it implements.
-- Documentation only: the scheduler does not read these tables yet.
--
-- Conventions (doc §1):
--   * ids are UUID strings (DRISTI style); reference ("master") tables are keyed by a short `code`.
--   * tenant_id = the High Court (DRISTI tenantId).
--   * audit columns follow DRISTI auditDetails: created_by, created_time, last_modified_by, last_modified_time.
--   * additional_details JSON on every table for fields a High Court needs that the model lacks.
--   * CHECK constraints only for small closed sets; open vocabularies live in master tables.
--   * Value lists in comments are indicative and vary by High Court.

-- =====================================================================
-- §2 Institution and places
-- =====================================================================

CREATE TABLE state_ut (
    code                VARCHAR PRIMARY KEY,          -- ISO 3166-2:IN, e.g. 'IN-KL'
    name                VARCHAR NOT NULL,
    kind                VARCHAR NOT NULL CHECK (kind IN ('state', 'union_territory')),
    additional_details  JSON
);

CREATE TABLE high_court (
    tenant_id           VARCHAR PRIMARY KEY,          -- DRISTI tenantId, e.g. 'kl'
    name                VARCHAR NOT NULL,             -- 'High Court of Kerala'
    short_code          VARCHAR,                      -- eCourts / NJDG state code
    established_on      DATE,
    principal_seat_city VARCHAR NOT NULL,
    sanctioned_strength INTEGER,                      -- permanent + additional judges
    website             VARCHAR,
    is_active           BOOLEAN DEFAULT TRUE,
    additional_details  JSON
);

-- A High Court can cover several states/UTs (Gauhati, Bombay, Punjab & Haryana, Madras, Calcutta, Kerala).
CREATE TABLE high_court_jurisdiction (
    tenant_id           VARCHAR NOT NULL REFERENCES high_court (tenant_id),
    state_ut_code       VARCHAR NOT NULL REFERENCES state_ut (code),
    PRIMARY KEY (tenant_id, state_ut_code)
);

-- Principal seat, permanent bench or circuit bench (DRISTI Court.establishment).
CREATE TABLE court_establishment (
    id                  VARCHAR PRIMARY KEY,
    tenant_id           VARCHAR NOT NULL REFERENCES high_court (tenant_id),
    name                VARCHAR NOT NULL,             -- 'Bombay HC, Nagpur Bench'
    kind                VARCHAR NOT NULL CHECK (kind IN ('principal_seat', 'permanent_bench', 'circuit_bench')),
    establishment_code  VARCHAR,                      -- eCourts establishment code (first 6 chars of a CNR)
    city                VARCHAR NOT NULL,
    state_ut_code       VARCHAR REFERENCES state_ut (code),
    address             VARCHAR,
    is_active           BOOLEAN DEFAULT TRUE,
    additional_details  JSON
);

-- The physical courtroom (DRISTI Court.courtRoom).
CREATE TABLE court_hall (
    id                  VARCHAR PRIMARY KEY,
    establishment_id    VARCHAR NOT NULL REFERENCES court_establishment (id),
    hall_number         VARCHAR NOT NULL,             -- 'Court 12', 'CH-3A'
    building            VARCHAR,
    floor               VARCHAR,
    seating_capacity    INTEGER,
    vc_enabled          BOOLEAN DEFAULT FALSE,
    is_active           BOOLEAN DEFAULT TRUE,
    additional_details  JSON
);

-- One row per non-ordinary day. Ordinary days are working days by default.
CREATE TABLE court_calendar (
    id                  VARCHAR PRIMARY KEY,
    tenant_id           VARCHAR NOT NULL REFERENCES high_court (tenant_id),
    establishment_id    VARCHAR REFERENCES court_establishment (id),  -- NULL = whole High Court
    day                 DATE NOT NULL,
    day_type            VARCHAR NOT NULL CHECK (day_type IN (
                            'holiday', 'restricted_holiday', 'vacation', 'vacation_sitting',
                            'working_saturday', 'half_day', 'no_sitting')),
    description         VARCHAR,                      -- 'Onam', 'Summer vacation'
    additional_details  JSON
);

-- Standard sitting hours per establishment and weekday (lunch recess splits the day).
CREATE TABLE court_timing (
    id                  VARCHAR PRIMARY KEY,
    establishment_id    VARCHAR NOT NULL REFERENCES court_establishment (id),
    weekday             INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- Mon=0
    sitting_start       TIME NOT NULL,                -- 10:15 / 10:30 / 11:00
    lunch_start         TIME,
    lunch_end           TIME,
    sitting_end         TIME NOT NULL,                -- 16:15 / 16:30
    valid_from          DATE NOT NULL,
    valid_to            DATE,
    additional_details  JSON
);

-- =====================================================================
-- §4 People and roles (created before judges/benches because they reference individual)
-- =====================================================================

-- Base identity for every human (DRISTI individualId).
CREATE TABLE individual (
    id                  VARCHAR PRIMARY KEY,
    tenant_id           VARCHAR REFERENCES high_court (tenant_id),
    name                VARCHAR NOT NULL,
    gender              VARCHAR,
    date_of_birth       DATE,                         -- drives the senior-citizen listing priority
    mobile_number       VARCHAR,
    email               VARCHAR,
    address             JSON,                         -- DRISTI AddressDetails
    preferred_language  VARCHAR,
    has_disability      BOOLEAN DEFAULT FALSE,
    is_active           BOOLEAN DEFAULT TRUE,
    additional_details  JSON,
    created_by VARCHAR, created_time TIMESTAMP, last_modified_by VARCHAR, last_modified_time TIMESTAMP
);

-- Government departments, companies, statutory bodies, law firms (DRISTI organisationID).
CREATE TABLE organisation (
    id                  VARCHAR PRIMARY KEY,
    tenant_id           VARCHAR REFERENCES high_court (tenant_id),
    name                VARCHAR NOT NULL,
    kind                VARCHAR NOT NULL,             -- state_government | central_government | psu | statutory_body | company | society | law_firm | ngo | other
    parent_id           VARCHAR,                      -- department hierarchy (self-reference, not enforced)
    registration_number VARCHAR,                      -- CIN / society reg no
    address             JSON,
    is_active           BOOLEAN DEFAULT TRUE,
    additional_details  JSON
);

-- Role catalogue: every role a person can play (doc §4 role table).
CREATE TABLE role (
    code                VARCHAR PRIMARY KEY,          -- 'court_master', 'advocate', 'petitioner', ...
    name                VARCHAR NOT NULL,
    category            VARCHAR NOT NULL CHECK (category IN (
                            'judicial', 'registry', 'courtroom', 'process', 'bar',
                            'government_counsel', 'party', 'court_appointee', 'state_agency')),
    description         VARCHAR
);

CREATE TABLE court_staff (
    id                  VARCHAR PRIMARY KEY,
    tenant_id           VARCHAR NOT NULL REFERENCES high_court (tenant_id),
    individual_id       VARCHAR NOT NULL REFERENCES individual (id),
    employee_code       VARCHAR,
    designation         VARCHAR NOT NULL,             -- as on the establishment's sanctioned post list
    role_code           VARCHAR NOT NULL REFERENCES role (code),
    establishment_id    VARCHAR REFERENCES court_establishment (id),
    joined_on           DATE,
    is_active           BOOLEAN DEFAULT TRUE,
    additional_details  JSON
);

CREATE TABLE law_chamber (
    id                  VARCHAR PRIMARY KEY,
    tenant_id           VARCHAR REFERENCES high_court (tenant_id),
    name                VARCHAR NOT NULL,
    organisation_id     VARCHAR REFERENCES organisation (id),  -- when the chamber is a registered firm
    address             JSON,
    additional_details  JSON
);

-- DRISTI Advocate.
CREATE TABLE advocate (
    id                       VARCHAR PRIMARY KEY,
    tenant_id                VARCHAR REFERENCES high_court (tenant_id),
    individual_id            VARCHAR NOT NULL REFERENCES individual (id),
    bar_registration_number  VARCHAR NOT NULL,        -- e.g. 'K/1234/2008'
    state_bar_council        VARCHAR,
    enrolment_date           DATE,
    designation              VARCHAR NOT NULL DEFAULT 'advocate' CHECK (designation IN ('advocate', 'senior_advocate')),
    advocate_type            VARCHAR,                 -- DRISTI advocateType
    law_chamber_id           VARCHAR REFERENCES law_chamber (id),
    organisation_id          VARCHAR REFERENCES organisation (id),
    status                   VARCHAR,                 -- DRISTI workflow status (APPLIED / ACTIVE / INACTIVE)
    is_active                BOOLEAN DEFAULT TRUE,
    additional_details       JSON,
    created_by VARCHAR, created_time TIMESTAMP, last_modified_by VARCHAR, last_modified_time TIMESTAMP
);

-- DRISTI AdvocateClerk: registered clerk who files, collects and tracks listings for an advocate.
CREATE TABLE advocate_clerk (
    id                  VARCHAR PRIMARY KEY,
    tenant_id           VARCHAR REFERENCES high_court (tenant_id),
    individual_id       VARCHAR NOT NULL REFERENCES individual (id),
    state_regn_number   VARCHAR,
    advocate_id         VARCHAR REFERENCES advocate (id),
    status              VARCHAR,
    is_active           BOOLEAN DEFAULT TRUE,
    additional_details  JSON
);

-- Law officers: Advocate General, AAG, Government Pleader, Public Prosecutor, ASG, CGSC, standing counsel.
CREATE TABLE government_counsel_office (
    id                  VARCHAR PRIMARY KEY,
    tenant_id           VARCHAR NOT NULL REFERENCES high_court (tenant_id),
    advocate_id         VARCHAR NOT NULL REFERENCES advocate (id),
    office_role         VARCHAR NOT NULL REFERENCES role (code),  -- advocate_general | public_prosecutor | ...
    represents_org_id   VARCHAR REFERENCES organisation (id),     -- the government / body represented
    valid_from          DATE NOT NULL,
    valid_to            DATE,
    additional_details  JSON
);

CREATE TABLE police_station (
    id                  VARCHAR PRIMARY KEY,
    tenant_id           VARCHAR REFERENCES high_court (tenant_id),
    name                VARCHAR NOT NULL,
    district            VARCHAR,
    state_ut_code       VARCHAR REFERENCES state_ut (code),
    additional_details  JSON
);

CREATE TABLE prison (
    id                  VARCHAR PRIMARY KEY,
    tenant_id           VARCHAR REFERENCES high_court (tenant_id),
    name                VARCHAR NOT NULL,             -- 'Central Prison, Poojappura'
    district            VARCHAR,
    vc_enabled          BOOLEAN DEFAULT FALSE,        -- undertrials produced by video link
    additional_details  JSON
);

-- =====================================================================
-- §3 Judges, benches and roster
-- =====================================================================

CREATE TABLE judge (
    id                  VARCHAR PRIMARY KEY,          -- DRISTI judgeId
    tenant_id           VARCHAR NOT NULL REFERENCES high_court (tenant_id),  -- current High Court
    individual_id       VARCHAR NOT NULL REFERENCES individual (id),
    designation         VARCHAR NOT NULL CHECK (designation IN (
                            'chief_justice', 'acting_chief_justice', 'judge', 'additional_judge')),
    seniority_rank      INTEGER,                      -- determines presiding judge on a division bench
    elevated_from       VARCHAR CHECK (elevated_from IN ('bar', 'service')),
    date_of_appointment DATE,
    date_of_retirement  DATE,                         -- 62nd birthday for High Court judges
    status              VARCHAR NOT NULL DEFAULT 'serving' CHECK (status IN ('serving', 'transferred', 'elevated', 'retired', 'resigned', 'deceased')),
    additional_details  JSON
);

-- Appointment history: additional → permanent, transfers between High Courts, elevation, acting CJ spells.
CREATE TABLE judge_tenure (
    id                  VARCHAR PRIMARY KEY,
    judge_id            VARCHAR NOT NULL REFERENCES judge (id),
    tenant_id           VARCHAR NOT NULL REFERENCES high_court (tenant_id),
    designation         VARCHAR NOT NULL,
    event               VARCHAR NOT NULL,             -- appointed | confirmed | transferred_in | transferred_out | acting_cj | elevated_sc | retired
    notification_ref    VARCHAR,                      -- Gazette / Ministry of Law notification
    valid_from          DATE NOT NULL,
    valid_to            DATE,
    additional_details  JSON
);

CREATE TABLE judge_leave (
    id                  VARCHAR PRIMARY KEY,
    judge_id            VARCHAR NOT NULL REFERENCES judge (id),
    from_date           DATE NOT NULL,
    to_date             DATE NOT NULL,
    session             VARCHAR DEFAULT 'full_day' CHECK (session IN ('full_day', 'forenoon', 'afternoon')),
    leave_type          VARCHAR,                      -- earned | medical | official_duty | personal
    notified_on         DATE,                         -- how much notice the listing section had
    additional_details  JSON
);

-- A bench is a sitting constituted by the Chief Justice for a period.
CREATE TABLE bench (
    id                  VARCHAR PRIMARY KEY,          -- DRISTI benchId
    tenant_id           VARCHAR NOT NULL REFERENCES high_court (tenant_id),
    establishment_id    VARCHAR NOT NULL REFERENCES court_establishment (id),
    court_hall_id       VARCHAR REFERENCES court_hall (id),
    bench_type          VARCHAR NOT NULL CHECK (bench_type IN (
                            'single', 'division', 'full', 'larger', 'special', 'vacation', 'special_night')),
    strength            INTEGER NOT NULL,             -- 1, 2, 3, 5 ...
    valid_from          DATE NOT NULL,
    valid_to            DATE,
    additional_details  JSON
);

CREATE TABLE bench_judge (
    bench_id            VARCHAR NOT NULL REFERENCES bench (id),
    judge_id            VARCHAR NOT NULL REFERENCES judge (id),
    is_presiding        BOOLEAN NOT NULL DEFAULT FALSE,
    seat_order          INTEGER NOT NULL,             -- 1 = presiding (senior-most)
    PRIMARY KEY (bench_id, judge_id)
);

-- The Chief Justice's "determination" / sitting list for a period (doc §3; upstream of our scope).
CREATE TABLE roster (
    id                  VARCHAR PRIMARY KEY,
    tenant_id           VARCHAR NOT NULL REFERENCES high_court (tenant_id),
    establishment_id    VARCHAR REFERENCES court_establishment (id),
    title               VARCHAR NOT NULL,             -- 'Roster w.e.f. 05.10.2026'
    notified_on         DATE NOT NULL,
    effective_from      DATE NOT NULL,
    effective_to        DATE,
    issued_by_judge_id  VARCHAR REFERENCES judge (id),  -- the Chief Justice
    document_uri        VARCHAR,
    additional_details  JSON
);

-- =====================================================================
-- §5 The case: reference tables
-- =====================================================================

CREATE TABLE case_type (
    code                VARCHAR PRIMARY KEY,          -- 'WP(C)', 'WA', 'CRL.A', 'BAIL APPL', 'ARB.P' ... (indicative)
    name                VARCHAR NOT NULL,
    tenant_id           VARCHAR REFERENCES high_court (tenant_id),  -- NULL = common across High Courts
    jurisdiction        VARCHAR NOT NULL CHECK (jurisdiction IN ('original', 'appellate', 'writ', 'revisional', 'reference', 'review', 'contempt', 'miscellaneous')),
    nature              VARCHAR NOT NULL CHECK (nature IN ('civil', 'criminal')),
    default_bench_strength INTEGER NOT NULL DEFAULT 1,
    limitation_days     INTEGER,                      -- filing limitation from the impugned order
    njdg_code           VARCHAR,
    is_active           BOOLEAN DEFAULT TRUE,
    additional_details  JSON
);

-- NJDG-style subject classification (service, land acquisition, tax, motor accident, ...).
CREATE TABLE subject_category (
    code                VARCHAR PRIMARY KEY,
    name                VARCHAR NOT NULL,
    parent_code         VARCHAR,                      -- category → sub-category (self-reference, not enforced)
    tenant_id           VARCHAR REFERENCES high_court (tenant_id),
    additional_details  JSON
);

CREATE TABLE statute (
    code                VARCHAR PRIMARY KEY,          -- 'NI_ACT_1881', 'BNSS_2023', 'CPC_1908', 'ARB_1996'
    name                VARCHAR NOT NULL,
    year                INTEGER,
    jurisdiction        VARCHAR,                      -- central | state code
    additional_details  JSON
);

-- Stage / sub-stage vocabulary (DRISTI CourtCase.stage, subStage). Drives the lifecycle in §7.
CREATE TABLE case_stage (
    code                VARCHAR PRIMARY KEY,          -- 'scrutiny', 'admission', 'notice', 'pleadings', 'final_hearing', ...
    name                VARCHAR NOT NULL,
    parent_code         VARCHAR,                      -- stage → sub-stage
    sequence            INTEGER,                      -- nominal order in the lifecycle
    is_terminal         BOOLEAN DEFAULT FALSE,
    default_purpose     VARCHAR,                      -- hearing_type.code usually listed at this stage
    additional_details  JSON
);

CREATE TABLE disposal_nature (
    code                VARCHAR PRIMARY KEY,          -- allowed | dismissed | partly_allowed | withdrawn | infructuous | dismissed_for_default | settled | transferred | abated | disposed_of
    name                VARCHAR NOT NULL,
    is_contested        BOOLEAN,                      -- NJDG contested / uncontested split
    additional_details  JSON
);

-- Hearing purposes (DRISTI Hearing.hearingType; scheduler/data.py HEARING_TYPES).
CREATE TABLE hearing_type (
    code                VARCHAR PRIMARY KEY,          -- 'mention', 'admission', 'interim_application', 'evidence', 'final_arguments', ...
    name                VARCHAR NOT NULL,
    priority            INTEGER NOT NULL,             -- 1–5
    est_minutes         INTEGER NOT NULL,
    p_heard             DOUBLE,                       -- from the hearing-failure distribution
    p_effective         DOUBLE,
    ideal_gap_days      INTEGER,
    min_gap_days        INTEGER,
    next_purpose_code   VARCHAR,                      -- what an effective hearing moves to (scheduler/data.py NEXT_PURPOSE)
    list_section        VARCHAR,                      -- default causelist section
    additional_details  JSON
);

-- Roster line: which bench takes which work, when (bench × category × type × stage × days).
CREATE TABLE roster_assignment (
    id                  VARCHAR PRIMARY KEY,
    roster_id           VARCHAR NOT NULL REFERENCES roster (id),
    bench_id            VARCHAR NOT NULL REFERENCES bench (id),
    case_type_codes     VARCHAR[],                    -- NULL = all
    subject_category_codes VARCHAR[],
    stages              VARCHAR[],                    -- 'fresh', 'after_notice', 'final_hearing', 'bail'
    filing_year_from    INTEGER,                      -- e.g. 'WP(C) of 2015–2018'
    filing_year_to      INTEGER,
    weekdays            INTEGER[],                    -- Mon=0
    session             VARCHAR DEFAULT 'full_day' CHECK (session IN ('full_day', 'forenoon', 'afternoon')),
    priority_order      INTEGER,                      -- order of the heads within the bench's list
    additional_details  JSON
);

CREATE TABLE application_type (
    code                VARCHAR PRIMARY KEY,          -- stay | condonation_of_delay | bail | suspension_of_sentence | amendment | impleadment | exemption | early_hearing | withdrawal | restoration | vacate_stay | extension_of_time ...
    name                VARCHAR NOT NULL,
    hearing_type_code   VARCHAR REFERENCES hearing_type (code),
    is_urgent_by_default BOOLEAN DEFAULT FALSE,
    additional_details  JSON
);

CREATE TABLE order_type (
    code                VARCHAR PRIMARY KEY,          -- notice | interim_stay | adjournment | admission | directions | dismissal | disposal | judgment | bail_grant | warrant | summons ...
    name                VARCHAR NOT NULL,
    order_category      VARCHAR CHECK (order_category IN ('intermediate', 'interlocutory', 'final', 'composite')),
    ends_case           BOOLEAN DEFAULT FALSE,
    additional_details  JSON
);

-- Hearing-failure taxonomy (doc §6); codes should match the organisers' distribution once released.
CREATE TABLE adjournment_reason (
    code                VARCHAR PRIMARY KEY,
    name                VARCHAR NOT NULL,
    failure_kind        VARCHAR NOT NULL CHECK (failure_kind IN ('not_heard', 'heard_not_effective')),
    attributable_to     VARCHAR NOT NULL CHECK (attributable_to IN ('party', 'advocate', 'court', 'state_agency', 'external')),
    preventable_by_scheduler BOOLEAN,                 -- e.g. prerequisite_pending, not_reached
    additional_details  JSON
);

-- =====================================================================
-- §5 The case: transactional tables
-- =====================================================================

-- DRISTI CourtCase. Denormalised listing fields are marked (cached).
CREATE TABLE court_case (
    id                  VARCHAR PRIMARY KEY,
    tenant_id           VARCHAR NOT NULL REFERENCES high_court (tenant_id),
    establishment_id    VARCHAR REFERENCES court_establishment (id),
    filing_number       VARCHAR NOT NULL UNIQUE,      -- assigned at e-filing, before scrutiny
    filing_date         DATE NOT NULL,                -- case age is measured from here
    cnr_number          VARCHAR UNIQUE,               -- 16-char eCourts CNR, on registration
    case_type_code      VARCHAR REFERENCES case_type (code),
    registration_number INTEGER,                      -- WP(C) No. 1234 / 2024 → 1234
    registration_year   INTEGER,
    registration_date   DATE,
    court_case_number   VARCHAR,                      -- display form 'WP(C) 1234/2024' (DRISTI courtCaseNumber)
    cmp_number          VARCHAR,                      -- DRISTI cmpNumber (pre-registration miscellaneous number)
    case_title          VARCHAR,                      -- 'A. Kumar v. State of Kerala'
    case_description    VARCHAR,
    nature              VARCHAR CHECK (nature IN ('civil', 'criminal')),
    subject_category_code VARCHAR REFERENCES subject_category (code),
    resolution_mechanism VARCHAR,                     -- DRISTI: court | mediation | lok_adalat | arbitration
    nature_of_pleading  VARCHAR,
    stage_code          VARCHAR REFERENCES case_stage (code),
    sub_stage_code      VARCHAR REFERENCES case_stage (code),
    status              VARCHAR NOT NULL CHECK (status IN (
                            'draft', 'under_scrutiny', 'defective', 'registered', 'pending',
                            'judgment_reserved', 'disposed', 'sine_die', 'stayed', 'transferred')),
    outcome             VARCHAR,                      -- DRISTI outcome, free text
    disposal_nature_code VARCHAR REFERENCES disposal_nature (code),
    disposal_date       DATE,
    judgement_date      DATE,                         -- DRISTI spelling
    bench_id            VARCHAR REFERENCES bench (id),     -- current bench seized of the matter
    judge_id            VARCHAR REFERENCES judge (id),     -- DRISTI judgeId (single-judge roster)
    is_part_heard       BOOLEAN DEFAULT FALSE,        -- tied to bench_id: part-heard stays with that bench
    valuation_amount    DECIMAL(18, 2),               -- suit / claim value
    court_fee_paid      DECIMAL(18, 2),
    access_code         VARCHAR,                      -- DRISTI join-case code
    -- priority flags (cached from party / custody / order; used by eligibility and scoring)
    is_urgent           BOOLEAN DEFAULT FALSE,
    is_senior_citizen   BOOLEAN DEFAULT FALSE,
    is_woman_litigant   BOOLEAN DEFAULT FALSE,
    is_child_related    BOOLEAN DEFAULT FALSE,
    is_in_custody       BOOLEAN DEFAULT FALSE,
    is_legal_aid        BOOLEAN DEFAULT FALSE,
    is_pil              BOOLEAN DEFAULT FALSE,
    is_on_hold          BOOLEAN DEFAULT FALSE,        -- sine die / stayed by higher court / awaiting connected matter
    -- listing state (cached)
    next_hearing_date   DATE,
    next_purpose_code   VARCHAR REFERENCES hearing_type (code),
    last_listed_date    DATE,
    last_heard_date     DATE,
    adjournment_count   INTEGER DEFAULT 0,
    consecutive_skips   INTEGER DEFAULT 0,            -- scheduler starvation guard
    remarks             VARCHAR,
    is_active           BOOLEAN DEFAULT TRUE,
    additional_details  JSON,
    created_by VARCHAR, created_time TIMESTAMP, last_modified_by VARCHAR, last_modified_time TIMESTAMP
);

CREATE TABLE case_statute_section (
    id                  VARCHAR PRIMARY KEY,
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    statute_code        VARCHAR NOT NULL REFERENCES statute (code),
    sections            VARCHAR[],                    -- ['138', '142']
    subsections         VARCHAR[],
    additional_details  JSON
);

-- The order under challenge, for appeals and revisions (lower courts are only referenced, not modelled).
CREATE TABLE lower_court_case (
    id                  VARCHAR PRIMARY KEY,
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    court_level         VARCHAR NOT NULL CHECK (court_level IN ('district_court', 'subordinate_court', 'tribunal', 'high_court_single_bench', 'authority')),
    court_name          VARCHAR NOT NULL,             -- 'Principal Sessions Court, Ernakulam'
    cnr_number          VARCHAR,
    case_number         VARCHAR,
    judge_name          VARCHAR,
    decision_date       DATE,
    decision_nature     VARCHAR,
    additional_details  JSON
);

-- DRISTI LinkedCase. Tagged / connected matters are heard together.
CREATE TABLE linked_case (
    id                  VARCHAR PRIMARY KEY,
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    linked_case_id      VARCHAR REFERENCES court_case (id),   -- NULL when the other case is outside this High Court
    case_number         VARCHAR,                      -- DRISTI caseNumber for external references
    relationship_type   VARCHAR NOT NULL CHECK (relationship_type IN (
                            'tagged', 'connected', 'batch', 'cross_appeal', 'review_of', 'contempt_of',
                            'appeal_from', 'restoration_of', 'transferred_from', 'slp_against', 'execution_of')),
    lead_case           BOOLEAN DEFAULT FALSE,        -- lead matter of a batch
    reference_uri       VARCHAR,
    is_active           BOOLEAN DEFAULT TRUE,
    additional_details  JSON
);

-- DRISTI Party. One row per party per case, individual or organisation.
CREATE TABLE party (
    id                  VARCHAR PRIMARY KEY,
    tenant_id           VARCHAR REFERENCES high_court (tenant_id),
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    party_category      VARCHAR NOT NULL CHECK (party_category IN ('individual', 'organisation')),
    individual_id       VARCHAR REFERENCES individual (id),
    organisation_id     VARCHAR REFERENCES organisation (id),
    party_type          VARCHAR NOT NULL,             -- petitioner | respondent | appellant | applicant | complainant | accused | state | caveator | intervenor | proforma_respondent
    party_number        VARCHAR,                      -- 'P1', 'R3'
    name                VARCHAR NOT NULL,             -- as in the cause title
    is_party_in_person  BOOLEAN DEFAULT FALSE,        -- DRISTI isPartyInPerson
    is_state            BOOLEAN DEFAULT FALSE,        -- State / Union of India
    legal_representative_of VARCHAR,                  -- party.id of a deceased party (not enforced)
    impleaded_on        DATE,
    deleted_on          DATE,
    is_active           BOOLEAN DEFAULT TRUE,
    additional_details  JSON
);

-- DRISTI AdvocateMapping / Representative: who appears for which party.
CREATE TABLE advocate_mapping (
    id                  VARCHAR PRIMARY KEY,
    tenant_id           VARCHAR REFERENCES high_court (tenant_id),
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    advocate_id         VARCHAR NOT NULL REFERENCES advocate (id),
    party_id            VARCHAR NOT NULL REFERENCES party (id),  -- DRISTI representing[]
    advocate_type       VARCHAR NOT NULL DEFAULT 'primary' CHECK (advocate_type IN ('primary', 'support', 'senior_briefed')),
    vakalatnama_date    DATE,                         -- memo of appearance for government counsel
    noc_date            DATE,                         -- no-objection on change of advocate
    valid_from          DATE,
    valid_to            DATE,
    is_active           BOOLEAN DEFAULT TRUE,
    additional_details  JSON
);

-- A caveat entitles the caveator to notice before any order is passed on a matching filing.
CREATE TABLE caveat (
    id                  VARCHAR PRIMARY KEY,
    tenant_id           VARCHAR NOT NULL REFERENCES high_court (tenant_id),
    caveat_number       VARCHAR NOT NULL,
    caveator_individual_id VARCHAR REFERENCES individual (id),
    caveator_organisation_id VARCHAR REFERENCES organisation (id),
    advocate_id         VARCHAR REFERENCES advocate (id),
    lower_court_ref     VARCHAR,                      -- the order the caveator expects to be challenged
    filed_on            DATE NOT NULL,
    expires_on          DATE NOT NULL,                -- 90 days under CPC s.148A
    matched_case_id     VARCHAR REFERENCES court_case (id),
    additional_details  JSON
);

-- Defects raised by the scrutiny section before registration.
CREATE TABLE scrutiny_defect (
    id                  VARCHAR PRIMARY KEY,
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    defect_code         VARCHAR,
    description         VARCHAR NOT NULL,
    raised_by_staff_id  VARCHAR REFERENCES court_staff (id),
    raised_on           DATE NOT NULL,
    cure_deadline       DATE,
    cured_on            DATE,
    additional_details  JSON
);

CREATE TABLE court_fee_payment (
    id                  VARCHAR PRIMARY KEY,
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    purpose             VARCHAR NOT NULL,             -- filing | application | process | copy | fine | cost
    amount              DECIMAL(18, 2) NOT NULL,
    payment_ref_number  VARCHAR,
    paid_on             DATE,
    status              VARCHAR,
    additional_details  JSON
);

-- Every stage change; lifecycle metrics (time in stage, stuck stages) are computed from this.
CREATE TABLE case_stage_history (
    id                  VARCHAR PRIMARY KEY,
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    from_stage_code     VARCHAR REFERENCES case_stage (code),
    to_stage_code       VARCHAR NOT NULL REFERENCES case_stage (code),
    changed_on          DATE NOT NULL,
    hearing_id          VARCHAR,                      -- hearing that caused it, if any (hearing is created later)
    order_id            VARCHAR,
    additional_details  JSON
);

CREATE TABLE case_status_history (
    id                  VARCHAR PRIMARY KEY,
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    from_status         VARCHAR,
    to_status           VARCHAR NOT NULL,
    changed_on          DATE NOT NULL,
    reason              VARCHAR,
    additional_details  JSON
);

-- Court-appointed participants: amicus curiae, commissioner, mediator, interpreter, legal-aid counsel, receiver.
CREATE TABLE case_appointment (
    id                  VARCHAR PRIMARY KEY,
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    individual_id       VARCHAR NOT NULL REFERENCES individual (id),
    role_code           VARCHAR NOT NULL REFERENCES role (code),
    appointed_by_order_id VARCHAR,                    -- court_order.id
    appointed_on        DATE NOT NULL,
    discharged_on       DATE,
    additional_details  JSON
);

-- =====================================================================
-- §6 Proceedings
-- =====================================================================

-- DRISTI Application (IA / CMP / MP). Listed with, and usually decided at, a hearing of its case.
CREATE TABLE application (
    id                  VARCHAR PRIMARY KEY,
    tenant_id           VARCHAR REFERENCES high_court (tenant_id),
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    application_number  VARCHAR NOT NULL,
    application_cmp_number VARCHAR,
    application_type_code VARCHAR NOT NULL REFERENCES application_type (code),
    reference_id        VARCHAR,                      -- DRISTI referenceId (e.g. the order it seeks to vary)
    created_date        DATE NOT NULL,
    filed_by_party_id   VARCHAR REFERENCES party (id),     -- DRISTI onBehalfOf
    filed_by_advocate_id VARCHAR REFERENCES advocate (id),
    reason_for_application VARCHAR,
    status              VARCHAR NOT NULL,             -- pending | listed | allowed | dismissed | withdrawn | closed
    decided_on          DATE,
    is_urgent           BOOLEAN DEFAULT FALSE,
    is_active           BOOLEAN DEFAULT TRUE,
    additional_details  JSON,
    created_by VARCHAR, created_time TIMESTAMP, last_modified_by VARCHAR, last_modified_time TIMESTAMP
);

-- Oral or written mentioning for urgent / out-of-turn listing, decided by the bench or the Registrar.
CREATE TABLE mention_memo (
    id                  VARCHAR PRIMARY KEY,
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    advocate_id         VARCHAR NOT NULL REFERENCES advocate (id),
    submitted_on        DATE NOT NULL,
    grounds             VARCHAR,
    requested_date      DATE,
    decision            VARCHAR CHECK (decision IN ('pending', 'granted', 'rejected', 'listed_in_due_course')),
    decided_by_judge_id VARCHAR REFERENCES judge (id),
    granted_date        DATE,
    additional_details  JSON
);

-- One published list per bench per date per list type. The scheduler's main output.
CREATE TABLE causelist (
    id                  VARCHAR PRIMARY KEY,
    tenant_id           VARCHAR NOT NULL REFERENCES high_court (tenant_id),
    bench_id            VARCHAR NOT NULL REFERENCES bench (id),
    judge_id            VARCHAR REFERENCES judge (id),   -- presiding judge; lets a single-judge tool skip bench
    court_hall_id       VARCHAR REFERENCES court_hall (id),
    list_date           DATE NOT NULL,
    list_type           VARCHAR NOT NULL CHECK (list_type IN ('daily', 'supplementary', 'advance', 'weekly', 'vacation', 'special')),
    published_at        TIMESTAMP,
    scheduling_run_id   VARCHAR,                      -- the run that produced it (§8)
    status              VARCHAR NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'published', 'revised')),
    additional_details  JSON,
    UNIQUE (bench_id, list_date, list_type)
);

CREATE TABLE causelist_item (
    id                  VARCHAR PRIMARY KEY,
    causelist_id        VARCHAR NOT NULL REFERENCES causelist (id),
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    serial_number       INTEGER NOT NULL,             -- item number called out in court
    list_section        VARCHAR NOT NULL,             -- fresh | admission | after_notice | for_orders | final_hearing | part_heard | judgment | mention
    purpose_code        VARCHAR NOT NULL REFERENCES hearing_type (code),
    application_ids     VARCHAR[],                    -- IAs listed with the case
    tag_group           VARCHAR,                      -- tagged/connected matters called together
    time_block          VARCHAR,                      -- scheduler block name
    window_start        TIMESTAMP,                    -- published appointment window
    window_end          TIMESTAMP,
    expected_minutes    DOUBLE,
    score               DOUBLE,
    reasons             VARCHAR[],                    -- the why-trail
    was_booked          BOOLEAN DEFAULT FALSE,        -- next date fixed at an earlier hearing
    additional_details  JSON
);

-- DRISTI Hearing. One per case per sitting where it is called (even if adjourned).
CREATE TABLE hearing (
    id                  VARCHAR PRIMARY KEY,
    tenant_id           VARCHAR REFERENCES high_court (tenant_id),
    hearing_id          VARCHAR,                      -- DRISTI human-readable id
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    filing_number       VARCHAR,                      -- DRISTI keys hearings by filing / CNR number
    cnr_numbers         VARCHAR[],                    -- tagged matters heard together
    application_numbers VARCHAR[],
    causelist_item_id   VARCHAR REFERENCES causelist_item (id),
    hearing_type_code   VARCHAR NOT NULL REFERENCES hearing_type (code),
    status              VARCHAR NOT NULL CHECK (status IN ('scheduled', 'in_progress', 'in_transcription', 'adjourned', 'closed', 'cancelled')),
    bench_id            VARCHAR REFERENCES bench (id),   -- DRISTI presidedBy.benchId
    judge_id            VARCHAR REFERENCES judge (id),   -- presidedBy.judgeId
    court_hall_id       VARCHAR REFERENCES court_hall (id),  -- presidedBy.courtId
    hearing_date        DATE NOT NULL,
    start_time          TIMESTAMP,                    -- actual call time
    end_time            TIMESTAMP,
    mode                VARCHAR CHECK (mode IN ('physical', 'virtual', 'hybrid')),
    vc_link             VARCHAR,
    transcript          VARCHAR,
    notes               VARCHAR,
    is_active           BOOLEAN DEFAULT TRUE,
    additional_details  JSON,
    created_by VARCHAR, created_time TIMESTAMP, last_modified_by VARCHAR, last_modified_time TIMESTAMP
);

-- DRISTI HearingAttendee plus presence (roll-call result).
CREATE TABLE hearing_attendance (
    id                  VARCHAR PRIMARY KEY,
    hearing_id          VARCHAR NOT NULL REFERENCES hearing (id),
    individual_id       VARCHAR REFERENCES individual (id),
    name                VARCHAR,
    attendee_type       VARCHAR NOT NULL,             -- DRISTI: complainant | respondent | lawyer | witness; extended with role codes
    party_id            VARCHAR REFERENCES party (id),
    advocate_id         VARCHAR REFERENCES advocate (id),
    was_present         BOOLEAN,
    attendance_mode     VARCHAR CHECK (attendance_mode IN ('physical', 'virtual')),
    arrived_at          TIMESTAMP,
    additional_details  JSON
);

-- What the hearing achieved. Separate from `hearing` so analytics never depend on DRISTI's workflow states.
CREATE TABLE hearing_outcome (
    hearing_id          VARCHAR PRIMARY KEY REFERENCES hearing (id),
    was_reached         BOOLEAN NOT NULL,             -- called before the court rose
    was_heard           BOOLEAN NOT NULL,             -- reached and taken up
    was_effective       BOOLEAN NOT NULL,             -- purpose met, case moved forward
    actual_minutes      DOUBLE,
    within_window       BOOLEAN,                      -- called inside the published window
    stage_before_code   VARCHAR REFERENCES case_stage (code),
    stage_after_code    VARCHAR REFERENCES case_stage (code),
    next_hearing_date   DATE,
    next_purpose_code   VARCHAR REFERENCES hearing_type (code),
    next_date_source    VARCHAR CHECK (next_date_source IN ('scheduler', 'judge', 'rollover', 'default', 'not_fixed')),
    additional_details  JSON
);

-- One row per reason; a hearing can fail for more than one.
CREATE TABLE adjournment (
    id                  VARCHAR PRIMARY KEY,
    hearing_id          VARCHAR NOT NULL REFERENCES hearing (id),
    reason_code         VARCHAR NOT NULL REFERENCES adjournment_reason (code),
    sought_by_party_id  VARCHAR REFERENCES party (id),
    sought_by_advocate_id VARCHAR REFERENCES advocate (id),
    costs_imposed       DECIMAL(18, 2),               -- adjournment costs (CPC O.XVII)
    is_last_opportunity BOOLEAN DEFAULT FALSE,
    remarks             VARCHAR,
    additional_details  JSON
);

-- DRISTI Order ("order" is reserved in SQL, hence court_order).
CREATE TABLE court_order (
    id                  VARCHAR PRIMARY KEY,
    tenant_id           VARCHAR REFERENCES high_court (tenant_id),
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    order_number        VARCHAR NOT NULL,
    linked_order_number VARCHAR,                      -- e.g. an order modifying an earlier one
    hearing_id          VARCHAR REFERENCES hearing (id),
    application_id      VARCHAR REFERENCES application (id),
    order_type_code     VARCHAR NOT NULL REFERENCES order_type (code),
    order_category      VARCHAR,
    bench_id            VARCHAR REFERENCES bench (id),   -- DRISTI issuedBy
    judge_id            VARCHAR REFERENCES judge (id),
    order_date          DATE NOT NULL,
    summary             VARCHAR,                      -- one-line gist for the case timeline
    order_text          VARCHAR,
    status              VARCHAR NOT NULL,             -- draft | signed | published
    document_uri        VARCHAR,
    is_active           BOOLEAN DEFAULT TRUE,
    additional_details  JSON,
    created_by VARCHAR, created_time TIMESTAMP, last_modified_by VARCHAR, last_modified_time TIMESTAMP
);

CREATE TABLE judgment (
    id                  VARCHAR PRIMARY KEY,
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    order_id            VARCHAR REFERENCES court_order (id),
    reserved_on         DATE,                         -- 'judgment reserved' after final arguments
    pronounced_on       DATE,
    author_judge_id     VARCHAR REFERENCES judge (id),
    bench_id            VARCHAR REFERENCES bench (id),
    neutral_citation    VARCHAR,                      -- '2026:KER:12345'
    disposal_nature_code VARCHAR REFERENCES disposal_nature (code),
    is_reportable       BOOLEAN,
    document_uri        VARCHAR,
    additional_details  JSON
);

-- DRISTI Task: process issued on an order. Open tasks are the scheduler's "prerequisites pending".
CREATE TABLE task (
    id                  VARCHAR PRIMARY KEY,
    tenant_id           VARCHAR REFERENCES high_court (tenant_id),
    task_number         VARCHAR NOT NULL,
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    order_id            VARCHAR REFERENCES court_order (id),
    task_type           VARCHAR NOT NULL,             -- DRISTI: summons | notice | warrant | bail.cash | bail.surety | document.submission
    task_description    VARCHAR,
    addressee_party_id  VARCHAR REFERENCES party (id),
    assigned_to_individual_id VARCHAR REFERENCES individual (id),  -- process server / police / advocate (dasti)
    responsible_advocate_id VARCHAR REFERENCES advocate (id),     -- for document.submission (counter, rejoinder)
    service_mode        VARCHAR,                      -- registered_post | speed_post | hand | dasti | email | sms | whatsapp | police | publication
    created_date        DATE NOT NULL,
    due_date            DATE,
    date_closed         DATE,
    service_status      VARCHAR CHECK (service_status IN ('pending', 'dispatched', 'served', 'complied', 'refused', 'unserved', 'returned', 'cancelled')),
    served_on           DATE,
    blocks_hearing_type VARCHAR REFERENCES hearing_type (code),  -- purpose that cannot proceed until this is done
    amount              DECIMAL(18, 2),               -- process fee / bail amount
    status              VARCHAR,                      -- DRISTI workflow status
    is_active           BOOLEAN DEFAULT TRUE,
    additional_details  JSON,
    created_by VARCHAR, created_time TIMESTAMP, last_modified_by VARCHAR, last_modified_time TIMESTAMP
);

-- DRISTI Artifact: pleadings, affidavits, submissions, exhibits, the Dimakar cover page.
CREATE TABLE artifact (
    id                  VARCHAR PRIMARY KEY,
    tenant_id           VARCHAR REFERENCES high_court (tenant_id),
    artifact_number     VARCHAR,
    evidence_number     VARCHAR,                      -- exhibit mark, e.g. 'P1', 'R3'
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    application_id      VARCHAR REFERENCES application (id),
    hearing_id          VARCHAR REFERENCES hearing (id),
    order_id            VARCHAR REFERENCES court_order (id),
    artifact_type       VARCHAR NOT NULL,             -- petition | counter_affidavit | rejoinder | written_statement | reply | written_submission | cover_page | affidavit | deposition | exhibit | vakalatnama | other
    filing_type         VARCHAR,                      -- DRISTI: caseFiling | application | direct
    media_type          VARCHAR CHECK (media_type IN ('DOC', 'AUDIO', 'VIDEO')),
    source_type         VARCHAR,                      -- DRISTI: COMPLAINANT | ACCUSED | COURT (extend: PETITIONER, RESPONDENT)
    source_party_id     VARCHAR REFERENCES party (id),
    filed_on            DATE,
    is_evidence         BOOLEAN DEFAULT FALSE,
    is_void             BOOLEAN DEFAULT FALSE,
    file_store_id       VARCHAR,
    description         VARCHAR,
    status              VARCHAR,
    additional_details  JSON,
    created_by VARCHAR, created_time TIMESTAMP, last_modified_by VARCHAR, last_modified_time TIMESTAMP
);

-- DRISTI Witness. In a High Court mostly the original side and election petitions.
CREATE TABLE witness (
    id                  VARCHAR PRIMARY KEY,
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    individual_id       VARCHAR REFERENCES individual (id),
    witness_identifier  VARCHAR,                      -- 'PW1', 'DW2'
    cited_by_party_id   VARCHAR REFERENCES party (id),
    designation         VARCHAR,
    is_expert           BOOLEAN DEFAULT FALSE,
    is_active           BOOLEAN DEFAULT TRUE,
    remarks             VARCHAR,
    additional_details  JSON
);

CREATE TABLE deposition (
    id                  VARCHAR PRIMARY KEY,
    witness_id          VARCHAR NOT NULL REFERENCES witness (id),
    hearing_id          VARCHAR NOT NULL REFERENCES hearing (id),
    examination         VARCHAR NOT NULL CHECK (examination IN ('chief', 'cross', 're_examination', 'court_question')),
    is_complete         BOOLEAN DEFAULT FALSE,
    artifact_id         VARCHAR REFERENCES artifact (id),  -- the recorded deposition
    additional_details  JSON
);

-- Custody status over time. An accused in custody gets listing priority for bail and appeals.
CREATE TABLE custody_status (
    id                  VARCHAR PRIMARY KEY,
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    party_id            VARCHAR NOT NULL REFERENCES party (id),
    status              VARCHAR NOT NULL CHECK (status IN ('in_custody', 'on_bail', 'sentence_suspended', 'absconding', 'released')),
    prison_id           VARCHAR REFERENCES prison (id),
    police_station_id   VARCHAR REFERENCES police_station (id),
    crime_number        VARCHAR,                      -- FIR / crime no. of the originating case
    valid_from          DATE NOT NULL,
    valid_to            DATE,
    additional_details  JSON
);

CREATE TABLE bail (
    id                  VARCHAR PRIMARY KEY,
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    party_id            VARCHAR NOT NULL REFERENCES party (id),
    order_id            VARCHAR REFERENCES court_order (id),
    bail_type           VARCHAR NOT NULL CHECK (bail_type IN ('regular', 'anticipatory', 'interim', 'default', 'suspension_of_sentence')),
    bond_amount         DECIMAL(18, 2),
    conditions          VARCHAR[],
    status              VARCHAR NOT NULL,             -- granted | executed | cancelled | forfeited
    granted_on          DATE,
    additional_details  JSON
);

CREATE TABLE surety (
    id                  VARCHAR PRIMARY KEY,
    bail_id             VARCHAR NOT NULL REFERENCES bail (id),
    individual_id       VARCHAR REFERENCES individual (id),
    name                VARCHAR NOT NULL,
    amount              DECIMAL(18, 2),
    is_verified         BOOLEAN DEFAULT FALSE,
    additional_details  JSON
);

-- Interim orders in force. Expiry forces a listing (stays lapse, extensions need a hearing).
CREATE TABLE interim_relief (
    id                  VARCHAR PRIMARY KEY,
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    order_id            VARCHAR NOT NULL REFERENCES court_order (id),
    relief_type         VARCHAR NOT NULL,             -- stay | injunction | status_quo | no_coercive_steps | interim_bail
    granted_on          DATE NOT NULL,
    valid_until         DATE,                         -- NULL = until further orders
    vacated_on          DATE,
    additional_details  JSON
);

-- Time-bound directions (file counter in 4 weeks, cure defects in 14 days, deposit costs).
CREATE TABLE compliance_deadline (
    id                  VARCHAR PRIMARY KEY,
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    order_id            VARCHAR REFERENCES court_order (id),
    responsible_party_id VARCHAR REFERENCES party (id),
    responsible_advocate_id VARCHAR REFERENCES advocate (id),
    action              VARCHAR NOT NULL,             -- file_counter | file_rejoinder | cure_defects | deposit | produce_records | serve_notice
    due_date            DATE NOT NULL,
    complied_on         DATE,
    blocks_hearing_type VARCHAR REFERENCES hearing_type (code),
    additional_details  JSON
);

-- SMS / email / app reminders (goal 4: reminders; goal 3: appointment windows).
CREATE TABLE notification (
    id                  VARCHAR PRIMARY KEY,
    tenant_id           VARCHAR REFERENCES high_court (tenant_id),
    case_id             VARCHAR REFERENCES court_case (id),
    causelist_item_id   VARCHAR REFERENCES causelist_item (id),
    recipient_individual_id VARCHAR NOT NULL REFERENCES individual (id),
    channel             VARCHAR NOT NULL CHECK (channel IN ('sms', 'email', 'whatsapp', 'app', 'ics')),
    template            VARCHAR NOT NULL,             -- listing_published | window_changed | reminder_t_minus_1 | order_uploaded | deadline_due
    sent_at             TIMESTAMP,
    delivery_status     VARCHAR,
    acknowledged_at     TIMESTAMP,                    -- intent-to-appear signal (L2/L3 input)
    will_appear         BOOLEAN,
    additional_details  JSON
);

-- =====================================================================
-- §4 Staff deployment (after bench / court_hall exist)
-- =====================================================================

-- Which staff serve which bench or court hall, for which period (Court Master, reader, PS, usher ...).
CREATE TABLE staff_assignment (
    id                  VARCHAR PRIMARY KEY,
    staff_id            VARCHAR NOT NULL REFERENCES court_staff (id),
    role_code           VARCHAR NOT NULL REFERENCES role (code),
    bench_id            VARCHAR REFERENCES bench (id),
    court_hall_id       VARCHAR REFERENCES court_hall (id),
    judge_id            VARCHAR REFERENCES judge (id),  -- personal staff (PS / stenographer) follow the judge
    valid_from          DATE NOT NULL,
    valid_to            DATE,
    additional_details  JSON
);

-- =====================================================================
-- §8 Scheduling layer (ours, not in DRISTI)
-- =====================================================================

-- A judge's style preset (presets/*.yaml), stored as data. Locked rules are NOT columns here.
CREATE TABLE scheduling_preset (
    id                  VARCHAR PRIMARY KEY,
    tenant_id           VARCHAR REFERENCES high_court (tenant_id),
    judge_id            VARCHAR REFERENCES judge (id),
    bench_id            VARCHAR REFERENCES bench (id),
    court_hall_id       VARCHAR REFERENCES court_hall (id),
    name                VARCHAR NOT NULL,             -- 'Justice Sehgal (block scheduler)'
    max_cases_per_day   INTEGER NOT NULL DEFAULT 60,
    listing_factor      DOUBLE NOT NULL DEFAULT 1.0,  -- clamped to the locked ceiling on load
    clustering          BOOLEAN DEFAULT FALSE,
    rollover            BOOLEAN DEFAULT FALSE,
    case_type_codes     VARCHAR[],                    -- NULL = all (Dimakar: arbitration only)
    weights             JSON,                         -- age, purpose, overdue, urgent, adjournments, fresh
    requires_cover_page_for VARCHAR[],                -- hearing types needing a cover page (Dimakar)
    valid_from          DATE,
    valid_to            DATE,
    source_yaml         VARCHAR,
    additional_details  JSON
);

CREATE TABLE time_block (
    id                  VARCHAR PRIMARY KEY,
    preset_id           VARCHAR NOT NULL REFERENCES scheduling_preset (id),
    name                VARCHAR NOT NULL,             -- 'A: fresh & notice'
    start_time          TIME NOT NULL,
    end_time            TIME NOT NULL,
    purpose_codes       VARCHAR[] NOT NULL,           -- hearing_type codes allowed in the block
    weekdays            INTEGER[] NOT NULL,           -- Mon=0
    sort_by             VARCHAR NOT NULL DEFAULT 'score' CHECK (sort_by IN ('score', 'age', 'newest')),
    min_age_years       DOUBLE,                       -- optional filter, e.g. 4y+ block
    additional_details  JSON
);

CREATE TABLE scheduling_run (
    id                  VARCHAR PRIMARY KEY,
    preset_id           VARCHAR NOT NULL REFERENCES scheduling_preset (id),
    run_at              TIMESTAMP NOT NULL,
    horizon_start       DATE NOT NULL,
    horizon_days        INTEGER NOT NULL,
    policy              VARCHAR NOT NULL,             -- l1 | l2 | l3 | baseline
    data_version        VARCHAR,                      -- roster snapshot / dataset release
    seed                INTEGER,
    code_version        VARCHAR,                      -- git sha
    clamped_rules       VARCHAR[],                    -- locked-rule corrections applied to the preset
    metrics             JSON,                         -- utilisation, predictability, ... for simulated runs
    additional_details  JSON
);

-- Every case the run considered, per day: listed, near-miss or excluded, with the score breakdown.
CREATE TABLE listing_decision (
    id                  VARCHAR PRIMARY KEY,
    run_id              VARCHAR NOT NULL REFERENCES scheduling_run (id),
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    list_date           DATE NOT NULL,
    decision            VARCHAR NOT NULL CHECK (decision IN ('listed', 'forced', 'near_miss', 'excluded', 'not_ranked')),
    time_block          VARCHAR,
    score               DOUBLE,
    score_components    JSON,                         -- {"age": 25, "purpose": 8, "overdue": 6, ...}
    exclusion_reason    VARCHAR,                      -- stage-1 reason when excluded
    reasons             VARCHAR[],
    causelist_item_id   VARCHAR REFERENCES causelist_item (id),
    additional_details  JSON
);

-- Judge / Court Master overrides and what they cost (judging criterion: visualise override impact).
CREATE TABLE schedule_override (
    id                  VARCHAR PRIMARY KEY,
    run_id              VARCHAR REFERENCES scheduling_run (id),
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    overridden_by       VARCHAR NOT NULL REFERENCES individual (id),
    action              VARCHAR NOT NULL CHECK (action IN ('add', 'remove', 'move_date', 'move_block', 'change_purpose', 'change_next_date', 'reorder')),
    from_value          VARCHAR,
    to_value            VARCHAR,
    reason              VARCHAR,
    overridden_at       TIMESTAMP NOT NULL,
    metric_delta        JSON,                         -- change in utilisation, predictability, 4y+ backlog ...
    additional_details  JSON
);

-- L2: per-listing predictions, stored so they can be calibrated against hearing_outcome.
CREATE TABLE prediction (
    id                  VARCHAR PRIMARY KEY,
    run_id              VARCHAR REFERENCES scheduling_run (id),
    case_id             VARCHAR NOT NULL REFERENCES court_case (id),
    list_date           DATE NOT NULL,
    model_name          VARCHAR NOT NULL,
    model_version       VARCHAR,
    p_heard             DOUBLE,
    p_effective         DOUBLE,
    expected_minutes    DOUBLE,
    days_until_ready    DOUBLE,                       -- survival model for the next date
    features            JSON,
    additional_details  JSON
);
