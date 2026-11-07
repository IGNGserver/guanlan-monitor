# Device State Console v3.0.172

## Device groups

- Ship device grouping across the Hub, Web/Desktop console, and Android client.
- Assign one or many devices to a user-defined group, filter the device directory and overview by group, collapse group sections, rename groups, and dissolve groups without deleting devices.
- Persist group assignments in both MySQL and local JSON storage and preserve them across subsequent device registrations and offline transitions.

## Consistency and realtime fixes

- Reject unknown, closed, duplicate, and legacy device IDs consistently before changing a group; local storage no longer creates ghost devices from a group request.
- Make batch group updates atomic in the MySQL repository and keep local JSON updates all-or-nothing.
- Broadcast group changes to connected clients and include the persisted group in offline device update events.

## Validation

- Added route, repository, realtime-event, and client contract coverage for group assignment, invalid IDs, persistence, and cross-client updates.
- Release assets and checksums are generated and verified by the tag-triggered GitHub Actions workflow.

This is the formal stable release containing the completed device-group feature and its consistency fixes.
