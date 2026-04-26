# AIMock Implementation Plan for WhatsForTea

## Objective
Integrate **AIMock** into the WhatsForTea testing infrastructure to enable fast, deterministic, zero-cost testing of LangGraph agents, A2UI event streams, and AWS Bedrock calls, completely isolated from real production APIs.

---

## Phase 1: Setup and Configuration ✅
**Goal:** Establish AIMock as the central mocking service in the local development environment.

1. **Dependency Installation** ✅
   - Add AIMock to the project's development dependencies.
   - *Note: AIMock requires zero dependencies itself, so it can be integrated cleanly into the existing Docker/Node setup.*

2. **Configuration (`aimock.json`)** ✅
   - Create a single `aimock.json` in the root or `tests/` directory.
   - Configure **LLMock** to intercept calls destined for AWS Bedrock (`anthropic.claude-3-haiku-20240307-v1:0` and `anthropic.claude-3-sonnet-20240229-v1:0`).
   - Configure **AG-UI** mock endpoints to simulate SSE streams.

3. **Environment Overrides** ✅
   - Create a `.env.test` file.
   - Override the AWS Bedrock endpoint/region variables to point to the local AIMock port (e.g., `http://localhost:8080/bedrock`).

---

## Phase 2: Mocking AWS Bedrock (Cost & Speed) ✅
**Goal:** Eliminate AWS costs and network latency during test runs.

1. **Record & Replay: Ingredient Normalizer** ✅
   - Run the 4-layer ingredient normalizer against the 55-item golden set.
   - Use AIMock in "Record" mode to capture Claude Haiku responses.
   - Save these as permanent fixtures.

2. **Record & Replay: Recipe Card Ingestion** ✅
   - Run the ingestion pipeline for a sample HelloFresh card (front + back).
   - Record the Claude Sonnet JSON extraction.
   - Ensure tests pass purely on the replay fixtures.

---

## Phase 3: Testing the A2UI Frontend ✅
**Goal:** Test the Next.js chat interface without needing the Python backend.

1. **Mocking SSE Streams** ✅
   - Create AIMock fixtures that simulate the LangGraph agent streaming tokens via the A2UI protocol.
   - Mock the emission of declarative UI widgets (`recipe_card`, `pantry_confirm`).

2. **Frontend UI Tests** ✅
   - Run the Next.js frontend against the AIMock AG-UI server.
   - Verify that the chat UI correctly renders the `pantry_confirm` widget when the mock stream dictates.

---

## Phase 4: Chaos & Resiliency Testing ✅
**Goal:** Validate system robustness under less-than-ideal LLM conditions.

1. **Simulating Hallucinations** ✅
   - Configure AIMock to return malformed tool calls or incorrect JSON structures during the card ingestion test.
   - Verify the backend gracefully catches these via Pydantic validation and prompts the LLM to retry (or fails cleanly).

2. **Simulating Network/Latency Failures** ✅
   - Inject artificial latency and timeouts into the Bedrock mocks.
   - Verify that the A2UI frontend displays appropriate loading states or error banners without crashing the active chat session.

---

## Phase 5: Delivery and CI/CD ✅
**Goal:** Make AIMock a seamless part of the developer workflow.

1. **Makefile Updates** ✅
   - Add commands: `make test-mock` (runs tests against fixtures) and `make record-fixtures` (refreshes the recorded Bedrock calls).

2. **Docker Compose Integration** ✅
   - Add an `aimock` service to `docker-compose.yml` (under a testing profile) so it spins up automatically when running integration tests.

3. **Documentation Update** ✅
   - Update `README.md` and `PRODUCT_OVERVIEW.md` to note that local testing relies on deterministic AIMock fixtures, eliminating the need for an AWS account just to run the test suite.
