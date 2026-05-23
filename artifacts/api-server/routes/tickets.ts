import { Router } from "express";
import { db } from "@workspace/db";
import { ticketsTable, insertTicketSchema } from "@workspace/db";
import {
  CreateTicketBody,
  GetTicketParams,
  DeleteTicketParams,
  GenerateTicketBody,
} from "@workspace/api-zod";
import { eq } from "drizzle-orm";
import OpenAI from "openai";

const router = Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `You are an expert at writing perfect Replit agent tickets. When given a rough description of what someone wants to build, you transform it into a clear, actionable, well-structured prompt that will get the best results from the Replit agent.

A perfect Replit agent ticket:
1. Starts with a clear one-sentence summary of what the app does
2. Lists the core features and user-facing functionality clearly
3. Specifies the tech stack preferences if relevant (or leaves it to the agent if not)
4. Describes data models and relationships where needed
5. Calls out any specific UX or design requirements
6. Mentions integrations, authentication, or external services needed
7. Keeps it focused — no fluff, no unnecessary implementation details
8. Is written in second-person imperative ("Build an app that...", "Create a...")

Respond with a JSON object with two fields:
- "title": A short 4-7 word title for the ticket (no "Build" prefix, just the product name/description)
- "generatedTicket": The full polished ticket text

The ticket should be 150-400 words — thorough but not bloated.`;

// GET /api/tickets
router.get("/tickets", async (req, res) => {
  const tickets = await db
    .select()
    .from(ticketsTable)
    .orderBy(ticketsTable.createdAt);
  res.json(
    tickets.map((t) => ({
      ...t,
      createdAt: t.createdAt.toISOString(),
    }))
  );
});

// POST /api/tickets
router.post("/tickets", async (req, res) => {
  const parsed = CreateTicketBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const [ticket] = await db
    .insert(ticketsTable)
    .values(parsed.data)
    .returning();
  res.status(201).json({ ...ticket, createdAt: ticket.createdAt.toISOString() });
});

// GET /api/tickets/stats
router.get("/tickets/stats", async (req, res) => {
  const all = await db.select({ id: ticketsTable.id }).from(ticketsTable);
  res.json({ total: all.length });
});

// POST /api/tickets/generate
router.post("/tickets/generate", async (req, res) => {
  const parsed = GenerateTicketBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 1024,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Here's my rough description of what I want to build:\n\n${parsed.data.roughInput}`,
      },
    ],
  });

  const content = completion.choices[0]?.message?.content ?? "{}";
  const result = JSON.parse(content) as {
    title?: string;
    generatedTicket?: string;
  };

  res.json({
    title: result.title ?? "Untitled Ticket",
    generatedTicket: result.generatedTicket ?? "",
  });
});

// GET /api/tickets/:id
router.get("/tickets/:id", async (req, res) => {
  const parsed = GetTicketParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [ticket] = await db
    .select()
    .from(ticketsTable)
    .where(eq(ticketsTable.id, parsed.data.id));
  if (!ticket) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ ...ticket, createdAt: ticket.createdAt.toISOString() });
});

// DELETE /api/tickets/:id
router.delete("/tickets/:id", async (req, res) => {
  const parsed = DeleteTicketParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(ticketsTable).where(eq(ticketsTable.id, parsed.data.id));
  res.status(204).send();
});

export default router;
