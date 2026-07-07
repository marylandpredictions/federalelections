v4 is the canonical publish stack.

This directory owns the clean forecast contract: one run manifest, one canonical
schema, row/evidence hashes, strict release gates, and UI adapters that read only
v4 outputs. v4 may block publish if trusted inputs are missing; it must not tune
numbers just to look better.
