# Cross review

- `reviewer-opponents` reviews from opposing counsel's perspective.
- `reviewer-judge` reviews admissibility, proof sufficiency, legal application, and judicial reasoning.
- `main` arbitrates the two reports and decides pass, fail, or manual review.

If delivery stamps exist but a detailed report is missing, classify the reviewer as partially executed. One completed reviewer and one failed reviewer may yield `completed_with_issues` only when Main arbitration and the final report are complete. Missing Main arbitration keeps cross-review failed.
