---
name: make-check
description: Run make check after architecture or governance changes and report any gate failures
user-invocable: false
---

Run `make check` and report the result.

If any gate fails, state which gate failed, what the error output says, and which file most likely caused it based on the error.

If all gates pass, say so in one sentence.
