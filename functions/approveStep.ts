import { Pool } from "pg";

const pool = new Pool({
  host: process.env.POSTGRES_HOST || "postgres",
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB || "local",
  user: process.env.POSTGRES_USER || "postgres",
  password: process.env.POSTGRES_PASSWORD || "postgres"
});

export default async function approveStep(
  req: any,
  res: any
) {
  const client = await pool.connect();

  try {
    const runId =
      req.body?.input?.run_id;

    const stepRunId =
      req.body?.input?.step_run_id;

    const sessionVariables =
      req.body?.session_variables || {};

    const userId =
      sessionVariables[
        "x-hasura-user-id"
      ];

    if (!userId) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication required"
      });
    }

    if (!runId && !stepRunId) {
      return res.status(400).json({
        success: false,
        message:
          "run_id or step_run_id is required"
      });
    }

    /*
     * Locate the paused approval step.
     */
    const approvalResult =
      await client.query(
        `
        SELECT
          sr.id AS step_run_id,
          sr.workflow_run_id,
          sr.workflow_step_id,
          sr.status AS step_status,
          wr.workflow_id,
          wr.organization_id,
          wr.status AS run_status,
          ws.type AS step_type
        FROM public.step_runs sr
        JOIN public.workflow_runs wr
          ON wr.id = sr.workflow_run_id
        JOIN public.workflow_steps ws
          ON ws.id = sr.workflow_step_id
        WHERE
          (
            ($1::uuid IS NOT NULL
             AND sr.workflow_run_id = $1::uuid)
            OR
            ($2::uuid IS NOT NULL
             AND sr.id = $2::uuid)
          )
          AND ws.type = 'approval_gate'
        LIMIT 1
        `,
        [
          runId || null,
          stepRunId || null
        ]
      );

    if (
      approvalResult.rows.length ===
      0
    ) {
      return res.status(404).json({
        success: false,
        message:
          "Approval step not found"
      });
    }

    const approval =
      approvalResult.rows[0];

    if (
      approval.run_status !==
      "paused"
    ) {
      return res.status(409).json({
        success: false,
        message:
          "Workflow is not paused"
      });
    }

    if (
      approval.step_status !==
      "paused"
    ) {
      return res.status(409).json({
        success: false,
        message:
          "Approval step is not waiting for approval"
      });
    }

    /*
     * Layer 1:
     * Verify that the approver belongs
     * to the workflow's organization.
     */
    const memberResult =
      await client.query(
        `
        SELECT role
        FROM public.org_members
        WHERE
          organization_id = $1
          AND user_id = $2
        LIMIT 1
        `,
        [
          approval.organization_id,
          userId
        ]
      );

    if (
      memberResult.rows.length ===
      0
    ) {
      return res.status(403).json({
        success: false,
        message:
          "You are not a member of this organization"
      });
    }

    const role =
      memberResult.rows[0].role;

    /*
     * Layer 2:
     * Only owner/editor may approve.
     */
    if (
      role !== "owner" &&
      role !== "editor"
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Only owner or editor can approve this step"
      });
    }

    /*
     * Record the approval.
     */
    await client.query(
      `
      UPDATE public.step_runs
      SET
        status = 'approved',
        approved_by = $1,
        approved_at = now(),
        completed_at = now()
      WHERE id = $2
      `,
      [
        userId,
        approval.step_run_id
      ]
    );

    /*
     * Resume the workflow.
     *
     * For this implementation the approval
     * gate is the final step, so the workflow
     * can now be completed.
     */
    await client.query(
      `
      UPDATE public.workflow_runs
      SET
        status = 'completed',
        completed_at = now(),
        error = NULL
      WHERE id = $1
        AND status = 'paused'
      `,
      [
        approval.workflow_run_id
      ]
    );

    return res.status(200).json({
      success: true,
      run_id:
        approval.workflow_run_id,
      step_run_id:
        approval.step_run_id,
      status: "completed",
      approved_by: userId,
      role,
      message:
        "Approval recorded and workflow resumed"
    });

  } catch (error: any) {
    console.error(
      "approveStep error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error?.message ||
        "Internal server error"
    });

  } finally {
    client.release();
  }
}
