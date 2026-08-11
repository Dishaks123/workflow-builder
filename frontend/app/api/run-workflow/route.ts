import { NextRequest, NextResponse } from "next/server";

const AUTH_URL =
  "https://local.auth.local.nhost.run/v1";

const FUNCTION_URL =
  "https://local.functions.local.nhost.run/v1/triggerWorkflowRun";

export async function POST(
  request: NextRequest
) {
  try {
    /*
     * =================================================
     * 1. Read request body
     * =================================================
     */

    const body =
      await request.json();

    /*
     * =================================================
     * 2. Get Authorization header
     * =================================================
     */

    const authorization =
      request.headers.get(
        "authorization"
      );

    if (!authorization) {
      return NextResponse.json(
        {
          success: false,
          status: "failed",
          run_id: null,
          message:
            "Authentication required",
        },
        {
          status: 401,
        }
      );
    }

    /*
     * =================================================
     * 3. Validate the access token against Nhost Auth
     *
     * We do NOT trust a user ID supplied by the browser.
     * Nhost determines the user from the Bearer token.
     * =================================================
     */

    const userResponse =
      await fetch(
        `${AUTH_URL}/user`,
        {
          method: "GET",

          headers: {
            Authorization:
              authorization,

            Accept:
              "application/json",
          },

          cache: "no-store",
        }
      );

    const userText =
      await userResponse.text();

    let userData: any = null;

    try {
      userData =
        JSON.parse(userText);
    } catch {
      userData = null;
    }

    console.log(
      "Auth validation status:",
      userResponse.status
    );

    /*
     * =================================================
     * 4. Reject invalid token
     * =================================================
     */

    if (
      !userResponse.ok ||
      !userData?.id
    ) {
      console.error(
        "Authentication validation failed:",
        userData
      );

      return NextResponse.json(
        {
          success: false,
          status: "failed",
          run_id: null,
          message:
            "Authentication required",
        },
        {
          status: 401,
        }
      );
    }

    /*
     * =================================================
     * 5. Authenticated user ID
     * =================================================
     */

    const userId =
      userData.id;

    console.log(
      "Authenticated user:",
      userId
    );

    /*
     * =================================================
     * 6. Build function request
     *
     * Your triggerWorkflowRun.ts already reads:
     *
     * req.body.session_variables
     *
     * so we provide it here.
     * =================================================
     */

    const functionBody = {
      input: {
        workflow_id:
          body?.input
            ?.workflow_id,
      },

      session_variables: {
        "x-hasura-user-id":
          userId,
      },
    };

    /*
     * =================================================
     * 7. Validate workflow ID
     * =================================================
     */

    if (
      !functionBody.input.workflow_id
    ) {
      return NextResponse.json(
        {
          success: false,
          status: "failed",
          run_id: null,
          message:
            "workflow_id is required",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * =================================================
     * 8. Call workflow function
     * =================================================
     */

    const functionResponse =
      await fetch(
        FUNCTION_URL,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Authorization:
              authorization,

            Accept:
              "application/json",
          },

          body:
            JSON.stringify(
              functionBody
            ),

          cache: "no-store",
        }
      );

    /*
     * =================================================
     * 9. Read response
     * =================================================
     */

    const functionText =
      await functionResponse.text();

    let functionData: any;

    try {
      functionData =
        JSON.parse(
          functionText
        );
    } catch {
      functionData = {
        success:
          functionResponse.ok,

        message:
          functionText,
      };
    }

    console.log(
      "Workflow function status:",
      functionResponse.status
    );

    console.log(
      "Workflow function response:",
      functionData
    );

    /*
     * =================================================
     * 10. Return exact function response to browser
     * =================================================
     */

    return NextResponse.json(
      functionData,
      {
        status:
          functionResponse.status,
      }
    );
  } catch (error: any) {
    console.error(
      "Workflow proxy error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        status: "failed",
        run_id: null,
        message:
          error?.message ||
          "Unable to connect to workflow service",
      },
      {
        status: 500,
      }
    );
  }
}
