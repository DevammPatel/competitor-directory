import { describe, it, expect, vi, beforeEach } from "vitest";
import { runCompetitorMonitoringJob } from "./competitorMonitoring";
import * as db from "../db";
import axios from "axios";

// Mock dependencies
vi.mock("../db");
vi.mock("axios");

vi.mock("../_core/env", () => ({
  ENV: {
    apifyApiKey: "test-apify-key",
  },
}));

describe("Competitor Monitoring Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("runCompetitorMonitoringJob", () => {
    it("should create a task log and process posts", async () => {
      const mockTaskLog = { id: 1, taskName: "daily-competitor-monitoring", status: "running" as const, startedAt: new Date() };
      
      const mockCompany = {
        id: "glean",
        name: "Glean",
        category: "ai-context" as const,
        description: null,
        website: null,
        linkedin: "https://linkedin.com/company/glean",
        twitter: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(db.createTaskLog).mockResolvedValue(mockTaskLog);
      vi.mocked(db.getCompanies).mockResolvedValue([mockCompany]);
      vi.mocked(db.getPeople).mockResolvedValue([]);
      
      vi.mocked(axios.post).mockResolvedValue({
        data: [
          {
            id: "post-123",
            linkedinUrl: "https://linkedin.com/company/glean/posts/123",
            author: { linkedinUrl: "https://linkedin.com/company/glean" },
            postedAt: "2026-05-20T10:00:00.000Z",
            content: "Test post from harvest",
          }
        ]
      });

      vi.mocked(db.addCompetitorPost).mockResolvedValue({
        id: 1,
        companyId: "glean",
        personId: null,
        sourceType: "company" as const,
        platform: "linkedin",
        postId: "post-123",
        content: "Test post from harvest",
        authorName: "Glean",
        authorUrl: "https://linkedin.com/company/glean",
        postUrl: "https://linkedin.com/company/glean/posts/123",
        postedAt: new Date(),
        fetchedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        likeCount: null,
        commentCount: null,
        shareCount: null,
      });

      vi.mocked(db.updateTaskLog).mockResolvedValue(undefined);

      await runCompetitorMonitoringJob();

      expect(db.createTaskLog).toHaveBeenCalled();
      expect(db.addCompetitorPost).toHaveBeenCalled();
      expect(db.updateTaskLog).toHaveBeenCalledWith(1, expect.objectContaining({
        status: "success",
        postsFound: 1,
      }));
    });

    it("should handle errors gracefully", async () => {
      const mockTaskLog = { id: 1, taskName: "daily-competitor-monitoring", status: "running" as const, startedAt: new Date() };
      const error = new Error("Test error");

      vi.mocked(db.createTaskLog).mockResolvedValue(mockTaskLog);
      vi.mocked(db.getCompanies).mockRejectedValue(error); // Trigger error
      vi.mocked(db.getPeople).mockResolvedValue([]);

      await runCompetitorMonitoringJob();

      expect(db.createTaskLog).toHaveBeenCalled();
      // Should create a failed task log on catch block
      expect(db.createTaskLog).toHaveBeenCalledWith(expect.objectContaining({
        status: "failed",
        error: "Error: Test error",
      }));
    });
  });
});
