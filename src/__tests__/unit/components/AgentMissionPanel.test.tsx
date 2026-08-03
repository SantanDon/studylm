import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AgentMissionPanel from "@/components/notebook/AgentMissionPanel";

const api = vi.hoisted(() => ({
  fetchAgentMissions: vi.fn(),
  createAgentMission: vi.fn(),
  runAgentMission: vi.fn(),
  updateAgentMission: vi.fn(),
  deleteAgentMission: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn());

vi.mock("@/services/apiService", () => ({ default: api }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { access_token: "COOKIE_SESSION" } }),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

const runningMission = {
  id: "mission-1",
  notebookId: "notebook-1",
  goal: "Compare the evidence and explain the strongest contradiction.",
  status: "running" as const,
  maxNotes: 5,
};

const completedMission = {
  ...runningMission,
  status: "completed" as const,
  result: {
    answer: "The sources agree on the measured result but disagree on causation.",
    noteId: "note-1",
    evidenceAudit: {
      status: "grounded" as const,
      verifiedCitationCount: 2,
      citedSourceCount: 2,
      contextSourceCount: 3,
      usableSourceCount: 4,
      contextCoveragePercent: 67,
      warnings: ["One selected context source was not cited."],
    },
  },
};

describe("AgentMissionPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchAgentMissions.mockResolvedValue({ missions: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls a durable running mission and renders the completed result", async () => {
    vi.useFakeTimers();
    api.fetchAgentMissions
      .mockResolvedValueOnce({ missions: [runningMission] })
      .mockResolvedValue({ missions: [completedMission] });

    render(<AgentMissionPanel notebookId="notebook-1" />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText(/preserves a recoverable state/i)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    expect(api.fetchAgentMissions).toHaveBeenCalledTimes(2);
    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(screen.getByText(/disagree on causation/i)).toBeInTheDocument();
  });

  it("resumes a paused mission before running it again", async () => {
    const user = userEvent.setup();
    const pausedMission = { ...runningMission, status: "paused" as const };
    api.fetchAgentMissions.mockResolvedValue({ missions: [pausedMission] });
    api.updateAgentMission.mockResolvedValue({
      mission: { ...pausedMission, status: "ready" as const },
    });
    api.runAgentMission.mockResolvedValue({
      mission: completedMission,
      result: completedMission.result,
    });

    render(<AgentMissionPanel notebookId="notebook-1" />);

    const resume = await screen.findByRole("button", {
      name: /resume and run/i,
    });
    await user.click(resume);

    await waitFor(() => {
      expect(api.updateAgentMission).toHaveBeenCalledWith(
        "mission-1",
        { status: "ready" },
        "COOKIE_SESSION",
      );
      expect(api.runAgentMission).toHaveBeenCalledWith(
        "mission-1",
        "COOKIE_SESSION",
      );
    });
    expect(await screen.findByText("completed")).toBeInTheDocument();
  });

  it("reveals grounding warnings when the student expands a report", async () => {
    const user = userEvent.setup();
    const longReport = {
      ...completedMission,
      result: {
        ...completedMission.result,
        answer: "Evidence detail. ".repeat(30),
      },
    };
    api.fetchAgentMissions.mockResolvedValue({ missions: [longReport] });

    render(<AgentMissionPanel notebookId="notebook-1" />);

    await user.click(await screen.findByRole("button", { name: /read report/i }));

    expect(
      screen.getByText("One selected context source was not cited."),
    ).toBeInTheDocument();
  });
});
