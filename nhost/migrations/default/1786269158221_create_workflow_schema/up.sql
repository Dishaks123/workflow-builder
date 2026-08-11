CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.organizations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    calls_used integer NOT NULL DEFAULT 0,
    calls_allowed integer NOT NULL DEFAULT 100,
    quota_period_start timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.org_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT org_members_role_check
        CHECK (role IN ('owner', 'editor', 'viewer')),

    CONSTRAINT org_members_organization_fk
        FOREIGN KEY (organization_id)
        REFERENCES public.organizations(id)
        ON DELETE CASCADE,

    CONSTRAINT org_members_unique_user_org
        UNIQUE (organization_id, user_id)
);

CREATE TABLE public.workflows (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT workflows_organization_fk
        FOREIGN KEY (organization_id)
        REFERENCES public.organizations(id)
        ON DELETE CASCADE
);

CREATE TABLE public.workflow_steps (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id uuid NOT NULL,
    position integer NOT NULL,
    type text NOT NULL,
    config jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT workflow_steps_workflow_fk
        FOREIGN KEY (workflow_id)
        REFERENCES public.workflows(id)
        ON DELETE CASCADE,

    CONSTRAINT workflow_steps_type_check
        CHECK (
            type IN (
                'llm_call',
                'http_request',
                'db_write',
                'notify',
                'conditional_branch',
                'approval_gate'
            )
        ),

    CONSTRAINT workflow_steps_position_check
        CHECK (position >= 0),

    CONSTRAINT workflow_steps_unique_position
        UNIQUE (workflow_id, position)
);

CREATE TABLE public.workflow_triggers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id uuid NOT NULL,
    type text NOT NULL,
    config jsonb NOT NULL DEFAULT '{}'::jsonb,
    enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT workflow_triggers_workflow_fk
        FOREIGN KEY (workflow_id)
        REFERENCES public.workflows(id)
        ON DELETE CASCADE,

    CONSTRAINT workflow_triggers_type_check
        CHECK (
            type IN (
                'manual',
                'webhook',
                'scheduled',
                'database_event'
            )
        )
);

CREATE TABLE public.workflow_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    started_at timestamptz,
    completed_at timestamptz,
    error text,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT workflow_runs_workflow_fk
        FOREIGN KEY (workflow_id)
        REFERENCES public.workflows(id)
        ON DELETE CASCADE,

    CONSTRAINT workflow_runs_organization_fk
        FOREIGN KEY (organization_id)
        REFERENCES public.organizations(id)
        ON DELETE CASCADE,

    CONSTRAINT workflow_runs_status_check
        CHECK (
            status IN (
                'pending',
                'running',
                'paused',
                'completed',
                'failed'
            )
        )
);

CREATE TABLE public.step_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_run_id uuid NOT NULL,
    workflow_step_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    input jsonb,
    output jsonb,
    error text,
    attempt_count integer NOT NULL DEFAULT 0,
    approved_by uuid,
    approved_at timestamptz,
    started_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT step_runs_workflow_run_fk
        FOREIGN KEY (workflow_run_id)
        REFERENCES public.workflow_runs(id)
        ON DELETE CASCADE,

    CONSTRAINT step_runs_workflow_step_fk
        FOREIGN KEY (workflow_step_id)
        REFERENCES public.workflow_steps(id)
        ON DELETE CASCADE,

    CONSTRAINT step_runs_status_check
        CHECK (
            status IN (
                'pending',
                'running',
                'paused',
                'completed',
                'failed',
                'approved'
            )
        ),

    CONSTRAINT step_runs_attempt_check
        CHECK (attempt_count >= 0)
);

CREATE INDEX idx_org_members_user_id
    ON public.org_members(user_id);

CREATE INDEX idx_org_members_organization_id
    ON public.org_members(organization_id);

CREATE INDEX idx_workflows_organization_id
    ON public.workflows(organization_id);

CREATE INDEX idx_workflow_steps_workflow_id
    ON public.workflow_steps(workflow_id);

CREATE INDEX idx_workflow_triggers_workflow_id
    ON public.workflow_triggers(workflow_id);

CREATE INDEX idx_workflow_runs_workflow_id
    ON public.workflow_runs(workflow_id);

CREATE INDEX idx_workflow_runs_organization_id
    ON public.workflow_runs(organization_id);

CREATE INDEX idx_step_runs_workflow_run_id
    ON public.step_runs(workflow_run_id);
