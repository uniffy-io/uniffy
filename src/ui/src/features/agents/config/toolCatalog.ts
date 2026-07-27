export interface ToolEntry {
    name: string;
    displayName: string;
    description: string;
    destructive: boolean;
}

export interface ToolGroup {
    group: string;
    tools: ToolEntry[];
}

export type ToolCategory = "platform" | "external";

export interface ToolCategorySection {
    category: ToolCategory;
    label: string;
    description: string;
    groups: ToolGroup[];
}

export const TOOL_SECTIONS: ToolCategorySection[] = [
    {
        category: "platform",
        label: "Platform Tools",
        description: "Select which workspace tools this agent can use",
        groups: [
            {
                group: "Notes",
                tools: [
                    { name: "notes.create_note", displayName: "Create Note", description: "Create a new note in the workspace", destructive: false },
                    { name: "notes.update_note", displayName: "Edit Note", description: "Update the content of an existing note", destructive: false },
                    { name: "notes.delete_note", displayName: "Delete Note", description: "Delete a note permanently", destructive: true },
                    { name: "notes.search_notes", displayName: "Search Notes", description: "Search notes by keyword", destructive: false },
                    { name: "notes.list_notes", displayName: "List Notes", description: "Browse notes without a search query", destructive: false },
                    { name: "notes.read_note", displayName: "Read Note", description: "Read the full content of a note", destructive: false },
                ],
            },
            {
                group: "Files",
                tools: [
                    { name: "files.search_files", displayName: "Search Files", description: "Search files by keyword", destructive: false },
                    { name: "files.list_files", displayName: "List Files", description: "Browse files and folders", destructive: false },
                    { name: "files.get_file_info", displayName: "File Info", description: "Get detailed metadata about a file", destructive: false },
                    { name: "files.read_file_content", displayName: "Read File", description: "Read the text content of a file or PDF", destructive: false },
                    { name: "files.update_file", displayName: "Edit File", description: "Update file name, tags, or description", destructive: false },
                    { name: "files.delete_file", displayName: "Delete File", description: "Move a file to trash", destructive: true },
                ],
            },
            {
                group: "Projects",
                tools: [
                    { name: "projects.create_project", displayName: "Create Project", description: "Create a project with name, icon, color, and visibility", destructive: false },
                    { name: "projects.update_project", displayName: "Edit Project", description: "Update project name, description, icon, color, or visibility", destructive: false },
                    { name: "projects.delete_project", displayName: "Delete Project", description: "Delete a project and all its tasks", destructive: true },
                    { name: "projects.list_projects", displayName: "List Projects", description: "List all accessible projects", destructive: false },
                ],
            },
            {
                group: "Tasks",
                tools: [
                    { name: "tasks.create_task", displayName: "Create Task", description: "Create tasks with subtasks, dependencies, assignees, sprints, and types", destructive: false },
                    { name: "tasks.update_task", displayName: "Edit Task", description: "Update any task field: status, priority, type, assignees, dates, dependencies, sprint", destructive: false },
                    { name: "tasks.delete_task", displayName: "Delete Task", description: "Delete a task permanently", destructive: true },
                    { name: "tasks.list_tasks", displayName: "List Tasks", description: "List tasks with filters for parent, sprint, or backlog", destructive: false },
                    { name: "tasks.move_task", displayName: "Move Task", description: "Move a task between status columns", destructive: false },
                ],
            },
            {
                group: "Calendar",
                tools: [
                    { name: "calendar.list_events", displayName: "List Events", description: "List events in a date range with optional calendar and category filters", destructive: false },
                    { name: "calendar.read_event", displayName: "Read Event", description: "Read full event details including attendees, recurrence, and description", destructive: false },
                    { name: "calendar.create_event", displayName: "Create Event", description: "Create events with attendees, recurrence, location, reminders, categories, and optional room booking via room_id", destructive: false },
                    { name: "calendar.update_event", displayName: "Edit Event", description: "Update any event field: times, attendees, recurrence, category, visibility", destructive: false },
                    { name: "calendar.delete_event", displayName: "Delete Event", description: "Delete a calendar event permanently", destructive: true },
                    { name: "calendar.add_attendees", displayName: "Add Attendees", description: "Invite users to an event as required or optional attendees", destructive: false },
                    { name: "calendar.remove_attendees", displayName: "Remove Attendees", description: "Remove attendees from an event", destructive: false },
                    { name: "calendar.rsvp", displayName: "RSVP", description: "Accept, tentatively accept, or decline an event invitation", destructive: false },
                    { name: "calendar.list_categories", displayName: "List Categories", description: "List available event categories for color coding", destructive: false },
                ],
            },
            {
                group: "Rooms",
                tools: [
                    { name: "rooms.list_rooms", displayName: "List Rooms", description: "List meeting rooms with optional capacity, amenity, building, or floor filters", destructive: false },
                    { name: "rooms.get_room", displayName: "Get Room", description: "Get a room's details and upcoming bookings", destructive: false },
                    { name: "rooms.list_bookings", displayName: "List Bookings", description: "List room bookings filtered by room, date range, or status", destructive: false },
                    { name: "rooms.find_available", displayName: "Find Available Rooms", description: "Find rooms free over a time window, with optional capacity and amenity filters", destructive: false },
                    { name: "rooms.book_room", displayName: "Book Room", description: "Reserve a room for a time slot", destructive: false },
                    { name: "rooms.cancel_booking", displayName: "Cancel Booking", description: "Cancel a room booking permanently", destructive: true },
                ],
            },
            {
                group: "Search",
                tools: [
                    { name: "search.query", displayName: "Search Content", description: "Search across all content types in the workspace", destructive: false },
                ],
            },
            {
                group: "People",
                tools: [
                    { name: "people.list_members", displayName: "List Members", description: "List organization members", destructive: false },
                ],
            },
            {
                group: "Memory",
                tools: [
                    { name: "memory.save", displayName: "Save Memory", description: "Remember information across conversations; the audience follows the space where it is saved", destructive: false },
                    { name: "memory.read", displayName: "Read Memory", description: "Read a stored memory by key, or search stored memories", destructive: false },
                    { name: "memory.forget", displayName: "Forget Memory", description: "Delete a stored memory", destructive: false },
                ],
            },
            {
                group: "Skills",
                tools: [
                    { name: "skills.propose_skill", displayName: "Propose Skill", description: "Draft a new or edited skill for the user to review and save", destructive: false },
                ],
            },
            {
                group: "Scheduling",
                tools: [
                    { name: "cron.create", displayName: "Create Scheduled Task", description: "Create a recurring scheduled task with a cron expression", destructive: false },
                    { name: "cron.list", displayName: "List Scheduled Tasks", description: "List all scheduled tasks for this agent", destructive: false },
                    { name: "cron.update", displayName: "Update Scheduled Task", description: "Update a scheduled task's name, prompt, schedule, or status", destructive: false },
                    { name: "cron.delete", displayName: "Delete Scheduled Task", description: "Delete a scheduled task permanently", destructive: true },
                    { name: "cron.get_runs", displayName: "View Run History", description: "View execution history of a scheduled task", destructive: false },
                ],
            },
            {
                group: "System",
                tools: [
                    { name: "system.current_time", displayName: "Current Time (UTC)", description: "Get the real current date and time in UTC", destructive: false },
                ],
            },
        ],
    },
    {
        category: "external",
        label: "External Tools",
        description: "Tools that use external provider APIs",
        groups: [
            {
                group: "Images",
                tools: [
                    { name: "images.generate_image", displayName: "Generate Image", description: "Generate an image from a text prompt using AI", destructive: false },
                ],
            },
        ],
    },
];

export const TOOL_CATALOG: ToolGroup[] = TOOL_SECTIONS.flatMap((s) => s.groups);
