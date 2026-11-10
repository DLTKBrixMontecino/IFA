Set the default CostpointLib framework root path for this installation.

The user will provide a Windows path as the argument (e.g. `C:\MyTFS\CostpointLib`).

Steps:
1. Read `ifa.config.json` in the project root if it exists; otherwise start with `{}`.
2. Set `frameworkRootPath` to the provided path.
3. Write the updated JSON back to `ifa.config.json` in the project root.
4. Confirm the path was saved and remind the user that this file is gitignored — each user sets their own path locally.
