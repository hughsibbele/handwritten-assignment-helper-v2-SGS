# Architecture

## System Overview

```mermaid
graph TB
    subgraph Actors
        T["<b>Teacher</b><br/>Sets up Canvas integration,<br/>syncs courses & rosters,<br/>manages assignments"]
        S["<b>Student</b><br/>Uploads handwritten photos,<br/>reviews transcriptions,<br/>confirms submissions"]
    end

    subgraph App ["Next.js App (Vercel)"]
        MW["Middleware<br/><i>Auth guard + role routing</i>"]
        TP["Teacher Pages<br/><i>/teacher/setup, /teacher/dashboard,<br/>/teacher/courses/[id]</i>"]
        SP["Student Pages<br/><i>/student/dashboard,<br/>/student/courses/.../assignments/[id],<br/>/student/submissions/[id]</i>"]
        API["API Routes<br/><i>/api/auth, /api/submissions,<br/>/api/canvas, /api/courses,<br/>/api/inngest</i>"]
    end

    subgraph Services ["External Services"]
        SB["<b>Supabase</b><br/>Postgres DB + Auth<br/>+ Storage + Realtime"]
        IG["<b>Inngest</b><br/>Background job queue<br/><i>Durable step functions</i>"]
        GM["<b>Gemini 2.5 Flash</b><br/>Handwriting OCR"]
        GD["<b>Google Drive/Docs</b><br/>Doc creation in<br/>student's Drive"]
        CV["<b>Canvas LMS</b><br/>Courses, assignments,<br/>rosters, submissions"]
    end

    T --> MW
    S --> MW
    MW --> TP
    MW --> SP
    TP --> API
    SP --> API

    API -- "Auth, DB reads/writes,<br/>file storage" --> SB
    API -- "Trigger transcription<br/>events" --> IG
    API -- "Create Google Docs,<br/>manage Drive folders" --> GD
    API -- "Sync courses/rosters,<br/>submit on behalf of student" --> CV
    IG -- "Download photos" --> SB
    IG -- "Transcribe images" --> GM
    IG -- "Save transcriptions" --> SB
    SB -. "Realtime updates<br/>(transcription progress)" .-> SP

    style T fill:#7a1e46,color:#fff,stroke:#54565b
    style S fill:#006890,color:#fff,stroke:#54565b
    style App fill:#f8f9fa,stroke:#54565b,stroke-width:2px
    style Services fill:#f0f4f8,stroke:#54565b,stroke-width:2px
```

## Database Schema

```mermaid
erDiagram
    teachers {
        uuid id PK
        uuid auth_user_id UK
        text email
        text display_name
        text canvas_base_url
        text canvas_api_token
    }

    courses {
        uuid id PK
        uuid teacher_id FK
        bigint canvas_course_id
        text name
        text short_name
        text term
        text join_code
        boolean is_active
    }

    students {
        uuid id PK
        uuid auth_user_id
        text email
        text display_name
        bigint canvas_user_id
        text google_access_token
        text google_refresh_token
        timestamptz google_token_expires_at
    }

    enrollments {
        uuid id PK
        uuid course_id FK
        uuid student_id FK
        text gdrive_folder_id
        boolean is_active
    }

    assignments {
        uuid id PK
        uuid course_id FK
        bigint canvas_assignment_id
        text title
        text description
        timestamptz due_date
        numeric points_possible
        text[] canvas_submission_types
        bigint canvas_discussion_topic_id
        boolean canvas_auto_submit
    }

    submissions {
        uuid id PK
        uuid assignment_id FK
        uuid student_id FK
        text status
        text transcription_text
        text gdoc_id
        text gdoc_url
        boolean submit_to_canvas
        timestamptz confirmed_at
    }

    submission_photos {
        uuid id PK
        uuid submission_id FK
        int page_number
        text storage_path
        text raw_transcription
        text status
    }

    teachers ||--o{ courses : "owns"
    courses ||--o{ assignments : "has"
    courses ||--o{ enrollments : "has"
    students ||--o{ enrollments : "enrolled via"
    students ||--o{ submissions : "creates"
    assignments ||--o{ submissions : "receives"
    submissions ||--o{ submission_photos : "contains"
```

## Student Submission Flow

This is the core flow — uploading handwritten work through to a finished Google Doc.

```mermaid
sequenceDiagram
    participant S as Student (Browser)
    participant App as Next.js API
    participant SB as Supabase
    participant IG as Inngest
    participant GM as Gemini 2.5 Flash
    participant GD as Google Drive/Docs
    participant CV as Canvas LMS

    Note over S,CV: 1. Upload Photos
    S->>App: POST /api/submissions (create)
    App->>SB: Insert submission (status: draft)
    App-->>S: submission ID

    S->>App: POST /api/submissions/{id}/photos
    App->>SB: Upload images to Storage
    App->>SB: Insert submission_photos (status: pending)
    App->>IG: Emit "photo.uploaded" event (per photo)
    App-->>S: ack

    Note over S,CV: 2. Async Transcription (Inngest pipeline)
    loop For each photo
        IG->>SB: Update photo status → processing
        IG->>SB: Download image from Storage
        IG->>GM: Send base64 image for OCR
        GM-->>IG: Transcription text
        IG->>SB: Save raw_transcription, status → completed
        IG->>SB: Delete image from Storage (text saved)
    end
    IG->>SB: All pages done → combine text, submission status → review

    Note over S,CV: 3. Real-time Progress
    SB-->>S: Realtime subscription (photo status updates)
    S->>S: UI shows per-page progress

    Note over S,CV: 4. Review & Confirm
    S->>S: Edit transcription in textarea
    S->>App: POST /api/submissions/{id}/confirm

    par Create Google Doc
        App->>GD: Get/create course folder in student's Drive
        App->>GD: Create Doc with transcription text
        App->>GD: Share folder with teacher
        GD-->>App: Doc URL
        App->>SB: Save gdoc_url, status → confirmed
    and Submit to Canvas (if enabled)
        App->>CV: Submit text entry (or discussion post)
        CV-->>App: ack
        App->>SB: status → submitted
    end

    App-->>S: Success (with Google Doc link)
```

## Teacher Setup & Sync Flow

```mermaid
sequenceDiagram
    participant T as Teacher (Browser)
    participant App as Next.js API
    participant SB as Supabase
    participant CV as Canvas LMS

    Note over T,CV: 1. Initial Setup
    T->>App: POST /api/teacher/setup/canvas
    App->>CV: Verify API token (fetch self)
    CV-->>App: OK
    App->>SB: Save canvas_base_url + canvas_api_token
    App-->>T: Connected

    Note over T,CV: 2. Course Sync
    T->>App: POST /api/canvas/courses/sync
    App->>CV: GET /api/v1/courses (teacher enrollment)
    CV-->>App: Course list
    App->>SB: Upsert courses

    loop For each course
        App->>CV: GET /api/v1/courses/{id}/assignments
        CV-->>App: Assignment list
        App->>SB: Upsert assignments

        App->>CV: GET /api/v1/courses/{id}/enrollments (students)
        CV-->>App: Student roster
        App->>SB: Upsert students + enrollments
    end

    App-->>T: Sync complete

    Note over T,CV: 3. Ongoing Management
    T->>T: Set short names per course (for Drive folders)
    T->>T: Toggle Canvas auto-submit per assignment
    T->>App: POST /api/courses/{id}/sync (manual re-sync)
```

## Authentication Flow

```mermaid
sequenceDiagram
    participant U as User (Browser)
    participant MW as Middleware
    participant App as Next.js
    participant SB as Supabase Auth
    participant G as Google OAuth

    U->>App: Visit /login
    App->>SB: signInWithOAuth(google, scopes: drive.file + documents)
    SB->>G: Redirect to Google consent
    G-->>SB: Auth code
    SB-->>App: Redirect to /api/auth/callback

    App->>SB: exchangeCodeForSession()
    SB-->>App: Session + Google tokens

    alt User email matches a teacher record
        App->>SB: Confirm teacher exists
        App-->>U: Redirect → /teacher/dashboard
    else User email matches a student record (from Canvas sync)
        App->>SB: Link auth_user_id to student, save Google tokens
        App-->>U: Redirect → /student/dashboard
    else No matching record
        App-->>U: Redirect → /student/dashboard (new student)
    end

    Note over U,G: Subsequent Requests
    U->>MW: Any protected route
    MW->>SB: Validate session
    alt Valid session
        MW->>App: Continue to route
    else Invalid/expired
        MW-->>U: Redirect → /login
    end
```
