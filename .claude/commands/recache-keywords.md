Refresh the IFA keyword cache.

Call `extract_framework_keywords` with `forceRefresh: true` (and no rootPath, to use the default CostpointLib path). Report how many keywords were extracted and confirm the cache was updated.

Use this command whenever the BrowserFramework C# source has been updated (new keywords added, existing ones renamed or removed) so that subsequent `consolidate_evidence` calls reflect the latest keyword definitions.
