# Model binding

Check the desktop five-Agent configuration, the active DSH model catalog, the selected provider/model, and the exact API error.

- `Model override not allowed`: the requested model is outside the runtime allowlist.
- HTTP 401: credential or provider binding is wrong for the requested model.
- HTTP 429: credentials may be valid, but the provider throttled the request.

A successful model-list request does not prove that the task's selected model can execute. Distinguish catalog discovery from the active Agent binding.
