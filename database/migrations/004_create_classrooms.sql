-- SAP migration 004
-- Classroom configuration for attendance proximity verification.

CREATE TABLE classrooms (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- Example: CSE-201, CSE-203
    code VARCHAR(50) NOT NULL UNIQUE,
    building VARCHAR(120),

    -- Nullable until real classroom coordinates are measured
    latitude NUMERIC(9, 6),
    longitude NUMERIC(9, 6),

    radius_meters NUMERIC(6, 2) NOT NULL,

    -- Location readings less accurate than this can be rejected
    max_accuracy_meters NUMERIC(6, 2) NOT NULL DEFAULT 100,

    -- Set to true only after coordinates have been reviewed in the field
    coordinates_verified BOOLEAN NOT NULL DEFAULT FALSE,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT classrooms_latitude_check
        CHECK (latitude BETWEEN -90 AND 90),

    CONSTRAINT classrooms_longitude_check
        CHECK (longitude BETWEEN -180 AND 180),

    CONSTRAINT classrooms_radius_check
        CHECK (radius_meters > 0 AND radius_meters <= 500),

    CONSTRAINT classrooms_accuracy_check
        CHECK (
            max_accuracy_meters > 0
            AND max_accuracy_meters <= 500
        ),

    -- Latitude and longitude must either both exist or both be empty
    CONSTRAINT classrooms_coordinates_pair_check
        CHECK (
            (latitude IS NULL AND longitude IS NULL)
            OR
            (latitude IS NOT NULL AND longitude IS NOT NULL)
        ),

    -- Coordinates cannot be marked as verified if they are missing
    CONSTRAINT classrooms_verified_coordinates_check
        CHECK (
            coordinates_verified = FALSE
            OR (latitude IS NOT NULL AND longitude IS NOT NULL)
        )
);