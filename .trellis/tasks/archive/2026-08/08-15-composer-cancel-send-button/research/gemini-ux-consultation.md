# Gemini UX consultation: generation action placement

## Question

When the active cancellation action moves from the workspace header into the
Composer action slot, should the idle manual Generate action remain in the
header or should the header generation slot be removed entirely?

## Gemini recommendation

Gemini 3.1 Pro (High) recommended removing the header generation slot and
adding a contextual Regenerate action to the cancelled transient response. Its
reasoning was that stopping in the Composer but restarting in the header splits
paired actions across distant locations, whereas both cancelled and failed
responses can recover consistently in the message surface.

Suggested state model:

| State | Suggested action placement |
| --- | --- |
| Idle and appendable | Composer shows Send; no header generation action |
| Starting / streaming | Composer shows Stop |
| Committing / reconciling | Composer submission unavailable; no header action |
| Cancelled | Transient response shows Regenerate |
| Failed | Transient response shows Regenerate |

Gemini rated the recommendation high confidence. It explicitly deferred the
interaction between a retained Composer draft and editing the cancelled user
prompt.

## Repository constraint found during review

The archived `08-10-auto-generate-after-send` PRD explicitly requires the
manual Generate control to remain as the retry/manual-generation entry point
for a selected eligible user message (R3), and lists removal of that control as
out of scope. Removing it now would therefore override an existing product
contract and remove more than post-cancel recovery unless an equivalent manual
generation entry point is relocated.

## Orchestrator assessment

Gemini's contextual recovery proposal is internally coherent, but it expands
this task from moving cancellation to redesigning manual generation. The
lower-risk scope is to retain idle Generate in the header and move only active
Cancel into Composer. A later task can redesign all manual generation entry
points together if spatial consistency is prioritized over the existing
contract.

## Provenance

- Model: `gemini-3.1-pro-high`
- Antigravity conversation: `cf441e72-6fb0-47e1-a90f-c10e2ce0c485`
- Consultation date: 2026-08-15

## Follow-up: saved user leaf without a ready Provider

After the header-removal direction was accepted, code review found that a user
message can be saved while Provider readiness is absent. Automatic generation
then returns without creating a failed or cancelled assistant projection, so a
cancelled-response Regenerate action cannot recover it.

Gemini recommended an always-visible contextual `Generate reply` action below
the eligible selected user message once the Provider is ready. It rejected:

- automatically generating when Provider readiness changes, because that can
  trigger stale, unexpected, or billable work without a current user gesture;
- overloading the Composer action with a third `Generate prior message`
  meaning, because the Composer visually owns the current draft;
- restoring the header action, because it breaks the accepted spatial model.

For the not-ready state Gemini also proposed a contextual
`Configure provider to generate` action. That part would require new wiring to
open the existing global settings dialog and remains a separate product choice.

### Mainstream evidence verification

Gemini's broad claim that all compared products follow the same complete state
model was stronger than its cited evidence. Independent verification supports
the narrower, relevant pattern:

- OpenAI documents a retry icon below the ChatGPT response and a `Try again`
  action, and separately documents Stop generation followed by Regenerate:
  <https://help.openai.com/en/articles/11909943-gpt-5-3-and-gpt-55-in-chatgpt>
  and <https://help.openai.com/en/articles/7996703-chatgpt-error-messages>.
- Google documents that Gemini regeneration is activated below the response:
  <https://support.google.com/gemini/answer/14262426>.
- The Anthropic and Perplexity links supplied by Gemini did not directly prove
  its claimed text-chat action placement, so those claims are treated as
  unverified and are not used as requirements.

These sources directly support contextual response recovery. They do not cover
Canopy's unique local-first case of a durable user leaf with no assistant state;
placing `Generate reply` under that user message is therefore a design inference
from the same contextual-action principle, not a copied documented behavior.
