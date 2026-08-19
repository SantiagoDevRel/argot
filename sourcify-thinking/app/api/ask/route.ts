import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { SYSTEM } from "@/lib/prompt";
import { ground } from "@/lib/ground";

export const runtime = "nodejs";
export const maxDuration = 120;

const MODEL = "claude-opus-5";

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set on this deployment." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    question?: string;
    history?: { role: "user" | "assistant"; content: string }[];
  };
  const question = (body.question ?? "").trim();
  if (!question) return NextResponse.json({ error: "empty question" }, { status: 400 });
  if (question.length > 4000) return NextResponse.json({ error: "question too long" }, { status: 400 });

  const client = new Anthropic();

  const messages: Anthropic.MessageParam[] = [
    ...(body.history ?? []).slice(-6).map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: question },
  ];

  try {
    // Streamed so a long answer cannot hit an HTTP timeout, but the text is
    // BUFFERED: nothing reaches the browser until it has been grounded. Never
    // show an unvalidated number, however briefly.
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      // xhigh measured: 56% more facts grounded (25 vs 16) for ~18% more latency.
      // For a room with a CTO in it, that trade is worth taking.
      output_config: { effort: "xhigh" },
      // The ledger is the whole system prompt and it is byte-stable across
      // requests, so it caches; only the question varies.
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages,
    });

    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      return NextResponse.json(
        { error: "The model declined to answer this one.", refusal: message.stop_details ?? null },
        { status: 200 },
      );
    }

    const raw = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const grounded = ground(raw);

    return NextResponse.json({
      html: grounded.html,
      raw,
      sources: grounded.used.map((f) => ({
        id: f.id,
        statement: f.statement,
        confidence: f.confidence,
        asOf: f.asOf,
        source: f.source ?? null,
      })),
      warnings: {
        unknownFactIds: grounded.unknownIds,
        ungroundedNumbers: grounded.ungroundedNumbers,
      },
      usage: {
        input: message.usage.input_tokens,
        output: message.usage.output_tokens,
        cacheRead: message.usage.cache_read_input_tokens ?? 0,
      },
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "The Anthropic API key was rejected." }, { status: 502 });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "Rate limited. Try again in a moment." }, { status: 429 });
    }
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `API error ${error.status}: ${error.message}` }, { status: 502 });
    }
    return NextResponse.json({ error: "Unexpected failure calling the model." }, { status: 500 });
  }
}
