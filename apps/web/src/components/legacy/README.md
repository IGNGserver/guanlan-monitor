# Legacy Web Components

This directory preserves the pre-unification Web dashboard for reference and
rollback. It is not part of the production route graph; `apps/web/src/app`
renders `UnifiedConsole`, which delegates the product UI to `@dsc/console-ui`.

Do not add new features here. If a behavior is still required, implement it in
the shared workspace and its platform adapter instead.
