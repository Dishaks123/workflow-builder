# AI Agent Workflow Builder

A full-stack AI Agent Workflow Builder built with **Nhost, Hasura, PostgreSQL, GraphQL, Next.js, React, TypeScript, Docker, and Nhost Functions**. The application allows users within organizations to create and execute multi-step AI workflows with role-based access control, quota management, approval gates, and real-time execution updates.

## Tech Stack

**Frontend:** Next.js 16, React 19, TypeScript, Nhost SDK, GraphQL/WebSocket  
**Backend:** Nhost, Hasura GraphQL Engine, PostgreSQL, Nhost Functions, Hasura Actions  
**Infrastructure:** Docker, Nhost CLI, GitHub

## Architecture

```text
Next.js / React
      |
      | Authentication + GraphQL
      v
Nhost / Hasura
      |
      +---- PostgreSQL
      |
      +---- Hasura Actions
      |         |
      |         +---- triggerWorkflowRun
      |         +---- approveStep
      |
      +---- GraphQL Subscriptions
                |
                v
          Live step status

Database Model
organizations
      |
      +---- org_members
      |
      +---- workflows
                |
                +---- workflow_steps
                +---- workflow_triggers
                +---- workflow_runs
                          |
                          +---- step_runs

The main tables are organizations, org_members, workflows, workflow_steps, workflow_triggers, workflow_runs, and step_runs. Workflow runs support states including running, paused, completed, and failed. Step runs store status, input, output, errors, attempt count, and approval information.

Workflow Steps

The workflow interface supports:

llm_call — performs an LLM request.
http_request — calls an external HTTP API.
conditional_branch — makes a decision based on previous output.
approval_gate — pauses execution until an authorized user approves.
db_write — database-writing step.
notify — notification step.
Authorization

The application uses organization membership and roles:

Owner: Full workflow and organization control.
Editor: Can create/edit workflows and trigger executions but cannot manage members.
Viewer: Read-only access and cannot trigger or approve workflows.

Authorization is scoped to the user's organization so that a user from Organization B cannot access Organization A's workflows simply by knowing or guessing an ID.

Workflow Execution

The main execution flow is:

User
 ↓
Next.js
 ↓
Hasura Action
 ↓
Authentication / Organization / Role Check
 ↓
Quota Check
 ↓
workflow_run
 ↓
LLM → HTTP → Conditional → Approval
 ↓
Paused
 ↓
Approval
 ↓
Workflow Completed

triggerWorkflowRun verifies the authenticated user, organization membership, role, and quota before creating and executing a workflow run. approveStep validates the approver before allowing a paused workflow to continue.

Approval Gate

When execution reaches an approval_gate, the workflow changes to:

paused

The frontend displays:

Paused — awaiting approval

An authorized user can approve the step, after which execution resumes and can reach:

Workflow completed
Real-Time Updates

The frontend subscribes to step_runs using a GraphQL WebSocket filtered by workflow_run_id.

Workflow Function
       ↓
PostgreSQL
       ↓
Hasura
       ↓
GraphQL WebSocket
       ↓
Next.js / React
       ↓
Live UI

The subscription was tested successfully and the browser received multiple live step_runs messages during workflow execution.

Tested End-to-End Scenario

The tested workflow, Milestone 3 Workflow, contains:

1. LLM Call
2. HTTP Request
3. Conditional Branch
4. Approval Gate

The complete tested flow is:

Login
 ↓
Run Workflow
 ↓
LLM Call
 ↓
HTTP Request
 ↓
Conditional Branch
 ↓
Approval Gate
 ↓
Paused — awaiting approval
 ↓
Approve Workflow
 ↓
Workflow Completed

The application successfully generated workflow Run IDs, updated quota usage, paused at the approval gate, resumed after approval, completed execution, and received live GraphQL subscription events.

Local Setup
Prerequisites
Node.js
npm
Docker Desktop
WSL (Windows)
Nhost CLI
Git
Clone
git clone https://github.com/Dishaks123/workflow-builder.git
cd workflow-builder
Start Nhost
nhost up

Verify services:

docker ps
Start Frontend
cd frontend
npm install
npm run dev

Open:

http://localhost:3000
Production Build
npm run build
Project Structure
workflow-builder/
├── frontend/
│   └── app/
├── functions/
│   ├── triggerWorkflowRun.ts
│   └── approveStep.ts
├── nhost/
│   ├── metadata/
│   └── migrations/
├── .gitignore
└── README.md
Security

Local secrets and generated files are excluded from Git using .gitignore.

Sensitive files such as .nhost, .secrets, .env, node_modules, and .next are not committed.

Repository

GitHub: https://github.com/Dishaks123/workflow-builder

Project Goal

This project demonstrates a full-stack AI workflow system using Nhost + Hasura + PostgreSQL + GraphQL + Next.js, with organization-based authorization, workflow execution, human approval gates, quota management, and real-time workflow monitoring.


Then run:

```bash
git add README.md
git commit -m "Add README documentation"
git push
