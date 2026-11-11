-- SAP migration 012
-- Administrator-managed attendance ranges and classroom configuration audit.
-- Existing installations that executed 001-011 should run this file once.

BEGIN;

-- Who last changed the attendance range, and when.
ALTER TABLE classrooms
    ADD COLUMN range_updated_at TIMESTAMPTZ,
    ADD COLUMN range_updated_by BIGINT;

ALTER TABLE classrooms
    ADD CONSTRAINT classrooms_range_updated_by_fk
        FOREIGN KEY (range_updated_by)
        REFERENCES administrators(user_id)
        ON DELETE SET NULL;

-- Every classroom range change is attributed to an administrator.
-- Previous and new values keep the audit trail readable even after the
-- classroom is configured again.
CREATE TABLE classroom_admin_actions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    admin_id BIGINT NOT NULL,
    classroom_id BIGINT NOT NULL,
    action VARCHAR(40) NOT NULL,
    reason VARCHAR(300),
    previous_values JSONB,
    new_values JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT classroom_admin_actions_admin_fk
        FOREIGN KEY (admin_id)
        REFERENCES administrators(user_id)
        ON DELETE RESTRICT,

    CONSTRAINT classroom_admin_actions_classroom_fk
        FOREIGN KEY (classroom_id)
        REFERENCES classrooms(id)
        ON DELETE RESTRICT,

    CONSTRAINT classroom_admin_actions_action_check
        CHECK (
            action IN (
                'range_updated',
                'coordinates_verified',
                'verification_revoked'
            )
        ),

    CONSTRAINT classroom_admin_actions_reason_check
        CHECK (
            reason IS NULL
            OR (reason = TRIM(reason) AND reason <> '')
        )
);

CREATE INDEX classroom_admin_actions_classroom_idx
    ON classroom_admin_actions(classroom_id, created_at DESC);

CREATE INDEX classroom_admin_actions_admin_idx
    ON classroom_admin_actions(admin_id, created_at DESC);

COMMIT;
