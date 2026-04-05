from typing import TypedDict, Literal, List, Any
from langgraph.graph import StateGraph, END
from langchain_core.messages import BaseMessage
from copilotkit import LangGraphAGUIAgent

class TeaBotAgentState(TypedDict):
    """
    Strict AgentState as per Section 11.1 of SPEC_V2.md.
    Mirror this field-for-field in frontend/src/lib/agents.ts.
    """
    messages: List[BaseMessage]
    hitl_status: Literal["idle", "waiting", "applied", "rejected"]
    a2ui: List[dict]
    error: str | None

def teabot_node(state: TeaBotAgentState):
    """
    Initial node for TeaBot. In Phase 1, it only handles prose conversations.
    """
    # Placeholder logic for Phase 1
    return {
        "messages": state.get("messages", []),
        "hitl_status": "idle",
        "a2ui": [],
        "error": None
    }

# Initialize the graph
workflow = StateGraph(TeaBotAgentState)
workflow.add_node("teabot", teabot_node)
workflow.set_entry_point("teabot")
workflow.add_edge("teabot", END)

# Compile the graph
teabot_agent = workflow.compile()

# CopilotKit integration for Phase 1
# This will be used in main.py to register the agent
teabot_coagent = LangGraphAGUIAgent(
    name="teabot",
    description="The primary kitchen assistant orchestrator.",
    graph=teabot_agent,
)
