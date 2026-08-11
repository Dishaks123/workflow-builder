import { NextRequest, NextResponse } from "next/server";

const AUTH_URL =
  "https://local.auth.local.nhost.run/v1";

const APPROVE_URL =
  "https://local.functions.local.nhost.run/v1/approveStep";

export async function POST(
  request: NextRequest
) {
  try {
    /*
     * Read request body
     */

    const body =
      await request.json();

    /*
     * Read access token
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
          message:
            "Authentication required",
        },
        {
          status: 401,
        }
      );
    }

    /*
     * Validate token with Nhost Auth
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
      "Auth status:",
      userResponse.status
    );

    if (
      !userResponse.ok ||
      !userData?.id
    ) {
      console.error(
        "Authentication failed:",
        userData
      );

      return NextResponse.json(
        {
          success: false,
          status: "failed",
          message:
            "Authentication required",
        },
        {
          status: 401,
        }
      );
    }

    /*
     * Authenticated user ID
     */

    const userId =
      userData.id;

    /*
     * Get run ID
     */

    const runId =
      body?.input?.run_id;

    const stepRunId =
      body?.input?.step_run_id;

    if (!runId && !stepRunId) {
      return NextResponse.json(
        {
          success: false,
          status: "failed",
          message:
            "run_id or step_run_id is required",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * Call approveStep function
     */

    const response =
      await fetch(
        APPROVE_URL,
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

          body: JSON.stringify({
            input: {
              run_id:
                runId,

              ...(stepRunId
                ? {
                    step_run_id:
                      stepRunId,
                  }
                : {}),
            },

            session_variables: {
              "x-hasura-user-id":
                userId,
            },
          }),

          cache: "no-store",
        }
      );

    const text =
      await response.text();

    let data: any;

    try {
      data =
        JSON.parse(text);
    } catch {
      data = {
        success:
          response.ok,

        message:
          text,
      };
    }

    console.log(
      "approveStep HTTP status:",
      response.status
    );

    console.log(
      "approveStep response:",
      data
    );

    return NextResponse.json(
      data,
      {
        status:
          response.status,
      }
    );
  } catch (error: any) {
    console.error(
      "Approval proxy error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        status: "failed",
        message:
          error?.message ||
          "Unable to connect to approval service",
      },
      {
        status: 500,
      }
    );
  }
}
