# Reel Studio — Storyboard Quality Rubric

Automated validation can prove a storyboard is *well-formed*: roles present, order
contiguous, transitions stated, prompts self-contained, no duplicate beats. It
cannot prove the sequence is *good*. This rubric is the human half of the gate.

Score every generated storyboard **before** any still image is generated. Images
cost credits and time; a storyboard that fails this rubric should be regenerated
or edited first.

---

## How to score

Score each category 1–5 against the definitions below. Judge the **sequence**,
not the individual frames — a set of individually striking images that could be
shuffled without changing the meaning scores 1 on narrative coherence no matter
how good each one looks.

| Score | Meaning |
|---|---|
| 5 | Could ship as-is. Exemplary. |
| 4 | Ships after minor edits. No structural problem. |
| 3 | Usable but weak. Needs a specific fix before generation. |
| 2 | Structurally wrong. Regenerate or rebuild the sequence. |
| 1 | Fails the category entirely. |

---

## Categories

### Hook clarity
Does shot 1 establish the central idea, visually and conceptually, in the first
beat? A frame that is merely striking but does not communicate the idea is a 2,
not a 4.

### Narrative coherence
Does the sequence read as one story with a beginning, a development and a
resolution — rather than a themed collection?

### Shot-to-shot dependency
Does each shot depend on the one before it? **Test it directly: swap two
adjacent middle shots. If the meaning survives, score 2 or below.**

### Visual continuity
Do location, subject, palette, lighting and lens stay consistent unless a change
is intentional and motivated? Every unexplained change costs a point.

### Emotional progression
Does intensity, specificity or meaning escalate across the sequence? A flat
sequence that stays at one emotional register scores 2.

### Message clarity
Could a viewer state the core message after one watch? Does it match the
`core_message` in the story strategy?

### Proof integration
Is the proof or payoff actually visible in the sequence? **If the approved
context contained no proof, the correct behaviour is to avoid implying any — an
honest sequence with no fabricated proof scores 4–5 here, not 1.** Invented
testimonials, metrics or results are an automatic 1 and a hard release block.

### Brand alignment
Is the brand applied strategically — grade, lens, mood and negatives shaping how
the story is told — rather than cosmetically bolted onto unrelated visuals?

### Prompt specificity
Is each `compiled_prompt` a complete image instruction: concrete subject, action,
composition, camera, light? Vague or abstract prompts score low even when the
narrative is strong.

### Production feasibility
Can the configured still-image and image-to-video pipeline actually produce each
frame? Penalise reliance on rendered text, logos, typography, precise hands, or
crowd scenes.

### Ending/payoff
Does the final shot resolve, invert or complete the opening image? An ending
unrelated to the opening scores 1–2.

### Overall impact
Would this sequence hold attention and change what the viewer believes?

---

## Minimum release criteria

A storyboard may proceed to image generation only when **all** of these hold:

```
No category below 3
Average score at least 4
Narrative coherence at least 4
Shot-to-shot dependency at least 4
Brand alignment at least 4
```

Plus two hard blocks, regardless of score:

- **No fabricated proof.** Any invented testimonial, metric, result or case study
  fails outright. Regenerate; do not edit around it.
- **No unapproved authority.** If the storyboard reflects positioning, offers or
  brand content that is not currently approved, stop and reconcile the context
  before regenerating.

---

## Recording a score

Record scores against the storyboard's provenance record so a quality trend can
be traced to a prompt or context change. The relevant identifiers are on
`video_projects`:

| Field | Why it matters |
|---|---|
| `storyboard_prompt_version` | Which prompt contract produced this |
| `storyboard_model` | Which model produced this |
| `storyboard_provenance.context_pack_version` | How context was assembled |
| `storyboard_provenance.context_file_ids` | Which approved context files fed it |
| `storyboard_provenance.brand_prompt_block_id` / `_version` | Which brand authority applied |
| `storyboard_provenance.repaired_after_critique` | Whether the critique pass had to intervene |

Suggested log line:

```
<project_ref> | <prompt_version> | <model> | scores: hook 4, coherence 4, dependency 5,
continuity 4, emotion 3, message 5, proof 4, brand 4, specificity 4, feasibility 5,
ending 5, impact 4 | avg 4.25 | PASS
```

---

## Using the rubric during a controlled test

1. Generate a storyboard on a **disposable** project bound to a known brief.
2. Score it with this rubric before generating any image.
3. Score the previous production storyboard for the same brief, if one exists.
4. Compare category by category — the categories that moved tell you whether the
   change was narrative (coherence, dependency, ending) or cosmetic (specificity,
   continuity).
5. Delete the disposable fixtures.

A single generation is not evidence. Score at least three storyboards across
different archetypes and awareness stages before concluding the change worked.
