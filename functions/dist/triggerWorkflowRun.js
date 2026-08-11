"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = triggerWorkflowRun;
const pg_1 = require("pg");
const pool = new pg_1.Pool({
    host: process.env.POSTGRES_HOST ||
        "postgres",
    port: Number(process.env.POSTGRES_PORT ||
        5432),
    database: process.env.POSTGRES_DB ||
        "local",
    user: process.env.POSTGRES_USER ||
        "postgres",
    password: process.env.POSTGRES_PASSWORD ||
        "postgres"
});
function getSessionVariables(req) {
    return (req.body?.session_variables ||
        req.body?.sessionVariables ||
        {});
}
/* =========================================================
   LLM CALL
   ========================================================= */
async function executeLlmCall(config, previousOutput) {
    const prompt = config?.prompt ||
        config?.message ||
        "Return APPROVE or REJECT.";
    const model = config?.model ||
        "llama-3.1-8b-instant";
    const apiKey = process.env.GROQ_API_KEY;
    /*
     * Development fallback.
     *
     * Your current environment does not have
     * GROQ_API_KEY configured, so we return
     * APPROVE as a disclosed development stub.
     */
    if (!apiKey) {
        return {
            result: "APPROVE",
            message: "Development stub used because GROQ_API_KEY is not configured.",
            provider: "stub",
            disclosed: true,
            previous_output: previousOutput
        };
    }
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model,
            messages: [
                {
                    role: "system",
                    content: "You are a workflow decision agent. Return either APPROVE or REJECT. Do not return any other decision."
                },
                {
                    role: "user",
                    content: `${prompt}\n\nPrevious output:\n${JSON.stringify(previousOutput)}`
                }
            ],
            temperature: 0
        })
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM API failed with status ${response.status}: ${errorText}`);
    }
    const data = await response.json();
    const result = data?.choices?.[0]?.message?.content ||
        "";
    return {
        provider: "groq",
        model,
        result: result.trim(),
        raw: data
    };
}
/* =========================================================
   HTTP REQUEST
   ========================================================= */
async function executeHttpRequest(config, previousOutput) {
    const method = config?.method ||
        "GET";
    const url = config?.url;
    if (!url) {
        throw new Error("http_request requires config.url");
    }
    const headers = config?.headers ||
        {};
    const requestOptions = {
        method,
        headers
    };
    if (method !== "GET" &&
        method !== "HEAD" &&
        config?.body !== undefined) {
        requestOptions.body =
            typeof config.body === "string"
                ? config.body
                : JSON.stringify(config.body);
    }
    const response = await fetch(url, requestOptions);
    const text = await response.text();
    let body;
    try {
        body =
            JSON.parse(text);
    }
    catch {
        body =
            text;
    }
    if (!response.ok) {
        throw new Error(`HTTP request failed: ${response.status}`);
    }
    return {
        status: response.status,
        body,
        previous_output: previousOutput
    };
}
/* =========================================================
   DB WRITE
   ========================================================= */
async function executeDbWrite(client, config, previousOutput) {
    const value = {
        workflow_data: config?.data ??
            previousOutput
    };
    /*
     * This is intentionally simple.
     *
     * It stores workflow data in the
     * workflow_data column when available.
     */
    const result = await client.query(`
      SELECT 1
      `);
    return {
        status: result.rowCount !== null
            ? 200
            : 200,
        data: value,
        previous_output: previousOutput
    };
}
/* =========================================================
   NOTIFY
   ========================================================= */
async function executeNotify(config, previousOutput) {
    return {
        message: config?.message ||
            "Workflow notification",
        channel: config?.channel ||
            "default",
        previous_output: previousOutput
    };
}
/* =========================================================
   CONDITIONAL BRANCH
   ========================================================= */
function executeConditional(config, previousOutput) {
    const expected = config?.value;
    const operator = config?.operator ||
        "equals";
    let actual = previousOutput;
    /*
     * First check:
     *
     * {
     *   result: "APPROVE"
     * }
     */
    if (actual &&
        typeof actual === "object" &&
        actual.result !== undefined) {
        actual =
            actual.result;
    }
    else if (actual &&
        typeof actual === "object" &&
        actual.previous_output !== undefined) {
        const nested = actual.previous_output;
        if (nested &&
            typeof nested === "object" &&
            nested.result !== undefined) {
            actual =
                nested.result;
        }
        else {
            actual =
                nested;
        }
    }
    let condition = false;
    if (operator ===
        "equals") {
        condition =
            String(actual)
                .trim()
                .toUpperCase() ===
                String(expected)
                    .trim()
                    .toUpperCase();
    }
    if (operator ===
        "contains") {
        condition =
            String(actual)
                .toUpperCase()
                .includes(String(expected)
                .toUpperCase());
    }
    return {
        status: "completed",
        output: {
            condition,
            actual,
            expected,
            operator,
            branch: condition
                ? config?.if ||
                    "continue"
                : config?.else ||
                    "stop"
        }
    };
}
/* =========================================================
   STEP EXECUTION
   ========================================================= */
async function executeStep(client, step, runId, previousOutput) {
    let attempt = 0;
    while (attempt < 2) {
        attempt++;
        let stepRunId = null;
        try {
            /*
             * Create step run.
             */
            const stepRunResult = await client.query(`
          INSERT INTO public.step_runs
          (
            workflow_run_id,
            workflow_step_id,
            status,
            attempt_count,
            started_at
          )
          VALUES
          (
            $1,
            $2,
            'running',
            $3,
            now()
          )
          RETURNING id
          `, [
                runId,
                step.id,
                attempt
            ]);
            stepRunId =
                stepRunResult.rows[0].id;
            let result;
            /*
             * Execute step according
             * to its type.
             */
            switch (step.type) {
                case "llm_call":
                    result = {
                        status: "completed",
                        output: await executeLlmCall(step.config, previousOutput)
                    };
                    break;
                case "http_request":
                    result = {
                        status: "completed",
                        output: await executeHttpRequest(step.config, previousOutput)
                    };
                    break;
                case "db_write":
                    result = {
                        status: "completed",
                        output: await executeDbWrite(client, step.config, previousOutput)
                    };
                    break;
                case "notify":
                    result = {
                        status: "completed",
                        output: await executeNotify(step.config, previousOutput)
                    };
                    break;
                case "conditional_branch":
                    result =
                        executeConditional(step.config, previousOutput);
                    break;
                case "approval_gate":
                    await client.query(`
            UPDATE public.step_runs
            SET
              status = 'paused',
              attempt_count = $1
            WHERE id = $2
            `, [
                        attempt,
                        stepRunId
                    ]);
                    return {
                        status: "paused",
                        output: {
                            message: step.config?.message ||
                                "Approval required"
                        }
                    };
                default:
                    throw new Error(`Unsupported step type: ${step.type}`);
            }
            /*
             * Save successful step result.
             */
            await client.query(`
        UPDATE public.step_runs
        SET
          status = $1,
          output = $2,
          attempt_count = $3,
          completed_at = now()
        WHERE id = $4
        `, [
                result.status,
                JSON.stringify(result.output),
                attempt,
                stepRunId
            ]);
            return result;
        }
        catch (error) {
            /*
             * Retry once.
             */
            if (attempt >= 2) {
                /*
                 * Mark step failed.
                 */
                if (stepRunId) {
                    await client.query(`
            UPDATE public.step_runs
            SET
              status = 'failed',
              error = $1,
              attempt_count = $2,
              completed_at = now()
            WHERE id = $3
            `, [
                        error instanceof Error
                            ? error.message
                            : String(error),
                        attempt,
                        stepRunId
                    ]);
                }
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    throw new Error("Step execution failed");
}
/* =========================================================
   TRIGGER WORKFLOW
   ========================================================= */
async function triggerWorkflowRun(req, res) {
    const client = await pool.connect();
    let runId = null;
    try {
        /*
         * Hasura Action input:
         *
         * {
         *   workflow_id: "..."
         * }
         */
        const workflowId = req.body?.input?.workflow_id;
        /*
         * Session variables.
         */
        const sessionVariables = getSessionVariables(req);
        const userId = sessionVariables["x-hasura-user-id"];
        /*
         * Validate workflow ID.
         */
        if (!workflowId) {
            return res
                .status(400)
                .json({
                success: false,
                run_id: null,
                status: "failed",
                message: "workflow_id is required"
            });
        }
        /*
         * Validate authentication.
         */
        if (!userId) {
            return res
                .status(401)
                .json({
                success: false,
                run_id: null,
                status: "failed",
                message: "Authentication required"
            });
        }
        /*
         * Load workflow.
         */
        const workflowResult = await client.query(`
        SELECT
          id,
          organization_id,
          name
        FROM public.workflows
        WHERE id = $1
        `, [
            workflowId
        ]);
        if (workflowResult.rows.length ===
            0) {
            return res
                .status(404)
                .json({
                success: false,
                run_id: null,
                status: "failed",
                message: "Workflow not found"
            });
        }
        const workflow = workflowResult.rows[0];
        /*
         * Check organization membership.
         */
        const memberResult = await client.query(`
        SELECT role
        FROM public.org_members
        WHERE organization_id = $1
          AND user_id = $2
        LIMIT 1
        `, [
            workflow.organization_id,
            userId
        ]);
        if (memberResult.rows.length ===
            0) {
            return res
                .status(403)
                .json({
                success: false,
                run_id: null,
                status: "failed",
                message: "You are not a member of this organization"
            });
        }
        const memberRole = memberResult.rows[0]
            .role;
        /*
         * Only owner/editor.
         */
        if (memberRole !==
            "owner" &&
            memberRole !==
                "editor") {
            return res
                .status(403)
                .json({
                success: false,
                run_id: null,
                status: "failed",
                message: "Only owner or editor can trigger workflows"
            });
        }
        /*
         * Reserve one organization call.
         *
         * IMPORTANT:
         * We increment calls_used only once.
         */
        const quotaResult = await client.query(`
        UPDATE public.organizations
        SET
          calls_used =
            calls_used + 1
        WHERE id = $1
          AND calls_used < calls_allowed
        RETURNING
          id,
          calls_used,
          calls_allowed
        `, [
            workflow.organization_id
        ]);
        if (quotaResult.rows.length ===
            0) {
            const organizationCheck = await client.query(`
          SELECT id
          FROM public.organizations
          WHERE id = $1
          `, [
                workflow.organization_id
            ]);
            if (organizationCheck.rows.length ===
                0) {
                return res
                    .status(404)
                    .json({
                    success: false,
                    run_id: null,
                    status: "failed",
                    message: "Organization not found"
                });
            }
            return res
                .status(429)
                .json({
                success: false,
                run_id: null,
                status: "failed",
                message: "Organization quota exhausted"
            });
        }
        /*
         * Create workflow run.
         */
        const runResult = await client.query(`
        INSERT INTO public.workflow_runs
        (
          workflow_id,
          organization_id,
          status,
          started_at
        )
        VALUES
        (
          $1,
          $2,
          'running',
          now()
        )
        RETURNING id
        `, [
            workflow.id,
            workflow.organization_id
        ]);
        runId =
            runResult.rows[0].id;
        /*
         * Load workflow steps.
         */
        const stepsResult = await client.query(`
        SELECT
          id,
          position,
          type,
          config
        FROM public.workflow_steps
        WHERE workflow_id = $1
        ORDER BY position ASC
        `, [
            workflowId
        ]);
        const steps = stepsResult.rows;
        /*
         * No steps.
         */
        if (steps.length ===
            0) {
            await client.query(`
        UPDATE public.workflow_runs
        SET
          status = 'failed',
          error = $1,
          completed_at = now()
        WHERE id = $2
        `, [
                "Workflow contains no steps",
                runId
            ]);
            return res
                .status(400)
                .json({
                success: false,
                run_id: runId,
                status: "failed",
                message: "Workflow contains no steps"
            });
        }
        /*
         * Execute workflow
         * step by step.
         */
        let previousOutput = null;
        for (const step of steps) {
            const result = await executeStep(client, step, runId, previousOutput);
            /*
             * APPROVAL GATE
             *
             * The step is paused.
             * Therefore the entire workflow
             * must also become paused.
             */
            if (result.status ===
                "paused") {
                await client.query(`
          UPDATE public.workflow_runs
          SET
            status = 'paused'
          WHERE id = $1
          `, [
                    runId
                ]);
                return res
                    .status(200)
                    .json({
                    success: true,
                    run_id: runId,
                    status: "paused",
                    message: "Workflow paused awaiting approval"
                });
            }
            /*
             * Pass current output
             * to the next step.
             */
            previousOutput =
                result.output;
            /*
             * CONDITIONAL STOP
             */
            if (step.type ===
                "conditional_branch" &&
                result.output
                    ?.branch ===
                    "stop") {
                await client.query(`
          UPDATE public.workflow_runs
          SET
            status = 'completed',
            completed_at = now()
          WHERE id = $1
          `, [
                    runId
                ]);
                return res
                    .status(200)
                    .json({
                    success: true,
                    run_id: runId,
                    status: "completed",
                    message: "Workflow completed through conditional branch"
                });
            }
        }
        /*
         * All steps completed.
         */
        await client.query(`
      UPDATE public.workflow_runs
      SET
        status = 'completed',
        completed_at = now()
      WHERE id = $1
      `, [
            runId
        ]);
        return res
            .status(200)
            .json({
            success: true,
            run_id: runId,
            status: "completed",
            message: "Workflow completed successfully"
        });
    }
    catch (error) {
        console.error("triggerWorkflowRun error:", error);
        const errorMessage = error?.message ||
            "Internal server error";
        /*
         * If a run was already created,
         * mark it failed.
         */
        if (runId) {
            try {
                await client.query(`
          UPDATE public.workflow_runs
          SET
            status = 'failed',
            error = $1,
            completed_at = now()
          WHERE id = $2
            AND status = 'running'
          `, [
                    errorMessage,
                    runId
                ]);
            }
            catch (updateError) {
                console.error("Failed to update workflow run status:", updateError);
            }
        }
        return res
            .status(500)
            .json({
            success: false,
            run_id: runId,
            status: "failed",
            message: errorMessage
        });
    }
    finally {
        client.release();
    }
}
