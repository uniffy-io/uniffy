## UWOS
***Work Infrastructure for the rest of us.***

---

### The Problem

Your notes are in one app. Files in another. Chat somewhere else. Calendar in a fourth. None of them talk to each other. You spend half your day copying links, searching for that doc you wrote last week, explaining the same thing twice because the info lives in six different places. Sounds familiar?

### Solution

UWOS is a unified system where everything connects. The system provides you with Notes, File Storage, Chat, Calendar, Project Management and Workflow Automations. These all components work together. They can reference each other natively with the already familiar experience of like mentioning someone with `@` in a chat app. However instead of just people, you can mention Notes, Files, Chat Messages, Calendar Events, and more. Chat messages can embed notes, files, calendar events, and more with a single keystroke. Your AI assistant can answer questions based on your actual work, with citations pointing back to the source.

### Privacy and Security

- The code is open source and available on [GitHub](https://github.com/uniffy-io/uwos.git) for anyone to inspect, audit, and contribute to.

- Your data is yours forever and we don't read it. UWOS can be self-hosted in an on-premise or private cloud environment, giving you full control over your data. UWOS don't collect telemetry, usage or personal data. We only phone home to check for updates if you enable that feature and to validate your license key if you're using a paid plan. For Enterprise customers, we can also offer a completely air-gapped deployment where no external network access is possible.

- Chat provides end-to-end encryption channels for sensitive conversations, so even the server can't read the messages.

### Freedom by choice

UWOS don't force you to use proprietary formats. You can export your whole organisation data in a directory structure. Most content (Notes, Calendar, Projects) stored in UWOS can be exported in Markdown format. Files can be downloaded in their original formats. Workflows and Chat are exportable in JSON / JSONL files.

```less
# This is an example structure of an exported organisation named "my-org"

/my-org
  /notes
    note-1.md
    note-2.md
  /files
    file-1.pdf
    file-2.png
  /chat
    chat-1.jsonl
    chat-2.jsonl
  /calendar
    event-1.md
    event-2.md
  /projects
    project-1.md
    project-2.md
  /workflows
    workflow-1.json
    workflow-2.json
```

### Licensing

| Feature                                   | Community | Team       | Business     | Enterprise |
| :---------------------------------------- | :-------- | :--------- | :----------- | :--------- |
| **Price**                                 | Free      | €7/user/mo | €15/user/mo  | Custom     |
| **Users**                                 | 10        | 50         | 500          | Unlimited  |
| **Organizations**                         | 1         | 1          | 5            | Unlimited  |
| Notes, Files, Chat, Calendar, Workflows   | ✅        | ✅         | ✅           | ✅         |
| Basic Spaces                              | ✅        | ✅         | ✅           | ✅         |
| Search                                    | ✅        | ✅         | ✅           | ✅         |
| Unlimited History (self-hosted)           | ✅        | ✅         | ✅           | ✅         |
| Unlimited History (cloud)                 | 90 days   | ✅         | ✅           | ✅         |
| AI-powered Spaces                         | ❌        | ✅         | ✅           | ✅         |
| Guest Access                              | ❌        | ✅         | ✅           | ✅         |
| SSO (SAML/OIDC)                           | ❌        | ❌         | ✅           | ✅         |
| Audit Logs (self-hosted)                  | ✅        | ✅         | ✅           | ✅         |
| Audit Logs (cloud)                        | 90 days   | ✅         | ✅           | ✅         |
| Custom Branding                           | ❌        | ❌         | ✅           | ✅         |
| SCIM Provisioning                         | ❌        | ❌         | ❌           | ✅         |
| Data Residency                            | ❌        | ❌         | ❌           | ✅         |
| Legal Hold                                | ❌        | ❌         | ❌           | ✅         |
| SLA                                       | ❌        | ❌         | 99.2%        | 99.98%     |
| Support                                   | Community | Email      | Priority     | Dedicated  |