# RecruitAI — Architecture

This document explains how the entire system fits together — from a user clicking "Score Candidates" to a ranked list appearing on screen.

---

## System Overview

```mermaid
graph TB
    subgraph Browser["Browser — React + Vite"]
        UI["UI Components<br/>(Steps 1–5)"]
        ZS["Zustand Stores<br/>(Auth + Recruit)"]
        AX["Axios API Client<br/>(JWT Interceptor)"]
        UI <--> ZS
        ZS <--> AX
    end

    subgraph Server["Express Backend — Node.js"]
        RT["Routes"]
        AM["Auth Middleware"]
        CT["Controllers"]
        SV["Services"]
        LLM["LLM Gateway<br/>(Multi-Provider)"]
        SSE["SSE Job Store<br/>(In-Memory Map)"]

        RT --> AM
        AM --> CT
        CT --> SV
        SV --> LLM
        CT --> SSE
    end

    subgraph Providers["LLM Providers"]
        GQ["Groq<br/>(Primary)"]
        CB["Cerebras<br/>(Fallback 1)"]
        GM["Gemini<br/>(Fallback 2)"]
        OR["OpenRouter<br/>(Last Resort)"]
    end

    subgraph DB["Database"]
        PG["PostgreSQL<br/>(Supabase)"]
    end

    AX -->|"HTTP / SSE<br/>JWT Bearer"| RT
    LLM --> GQ
    LLM --> CB
    LLM --> GM
    LLM --> OR
    CT --> PG
```

---

## Request Lifecycle

Every API request follows a consistent path through the backend:

```mermaid
sequenceDiagram
    participant C as Client
    participant R as Router
    participant A as Auth Middleware
    participant CT as Controller
    participant S as Service
    participant AI as LLM Gateway
    participant DB as PostgreSQL

    C->>R: HTTP Request
    R->>A: Route Match
    
    alt Protected Route
        A->>A: Verify JWT Token
        A-->>C: 401 if invalid
    end
    
    A->>CT: req.user attached
    CT->>S: Business Logic
    
    alt AI-Powered Endpoint
        S->>AI: callAI(prompt, data)
        AI-->>S: Structured JSON
    end
    
    alt Database Operation
        CT->>DB: SQL Query
        DB-->>CT: Result
    end
    
    CT-->>C: JSON Response
```

---

## Data Flow — Step by Step

### Authentication Flow

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant B as Backend
    participant DB as PostgreSQL

    U->>F: Open App
    F->>F: Check LocalStorage for JWT

    alt Token Exists
        F->>B: GET /api/auth/me
        B->>B: Verify JWT
        B-->>F: User Profile
        F->>F: Restore Session
    else No Token
        U->>F: Enter Credentials
        F->>B: POST /api/auth/signup or /login
        B->>DB: Create/Verify User
        B->>B: Sign JWT Token
        B-->>F: { token, user }
        F->>F: Store JWT in LocalStorage
    end
```

---

### Step 1 — Parse Job Description

```mermaid
flowchart LR
    A["User pastes<br/>JD text"] --> B["POST /api/jd/parse"]
    B --> C["jd.controller.js"]
    C --> D["callAI with<br/>PARSE_JD_PROMPT"]
    D --> E["LLM Gateway<br/>(tries model chain)"]
    E --> F["Structured JSON"]
    F --> G["{ title, mustHave[],<br/>niceToHave[],<br/>hardSkills[],<br/>softSkills[] }"]
```

**Output**: Structured job requirements stored in Zustand `parsedJD`.

---

### Step 2 — Upload & Parse CVs

```mermaid
flowchart LR
    A["User drops<br/>PDF/DOCX files"] --> B["POST /api/cv/parse-batch<br/>(multipart, max 50)"]
    B --> C["cv.controller.js"]
    C --> D["parser.service.js"]
    D --> E{"File Type?"}
    E -->|PDF| F["pdf-parse"]
    E -->|DOCX| G["mammoth"]
    F --> H["Raw Text"]
    G --> H
    H --> I["callAI with<br/>PARSE_CV_PROMPT"]
    I --> J["Structured<br/>Candidate JSON"]
```

**Output**: Array of `{ filename, parsed: { name, skills[], workHistory[] }, status }`.

---

### Step 3 — Score & Rank (SSE Pipeline)

This is the most complex flow — it uses **Server-Sent Events** for real-time progress reporting.

```mermaid
sequenceDiagram
    participant C as Client
    participant API as Backend
    participant Store as SSE Job Store
    participant AI as LLM Gateway

    C->>API: POST /api/score/batch<br/>{ jd, candidates[] }
    API->>Store: Create job (UUID)
    API-->>C: { jobId }

    C->>API: GET /api/score/progress/:jobId<br/>(EventSource - SSE)

    loop For Each Candidate (8 parallel)
        API->>AI: callAI(SCORE_PROMPT, payload)
        AI-->>API: Score JSON
        API->>Store: Update Progress
        Store-->>C: SSE "progress" event
    end

    API->>API: Sort by overallScore desc
    API->>API: Assign rank + shortlisted (top 10)
    Store-->>C: SSE "done" event<br/>{ rankedCandidates[] }
```

**Scoring Dimensions** (5 categories):

```mermaid
mindmap
  root((Overall<br/>Score))
    Skills Match
      Hard Skills
      Soft Skills
    Experience
      Years
      Relevance
    Education
      Degree Level
      Field Match
    Culture Fit
      Values Alignment
      Work Style
    Communication
      Clarity
      Presentation
```

---

### Step 4 — Bias Detection (Auto-triggered)

```mermaid
flowchart LR
    A["Scoring<br/>Complete"] --> B["POST /api/bias/check"]
    B --> C["bias.controller.js"]
    C --> D["callAI with<br/>BIAS_CHECK_PROMPT"]
    D --> E["Analysis Result"]
    E --> F{"Bias<br/>Detected?"}
    F -->|Yes| G["Warning Banner<br/>+ Recommendations"]
    F -->|No| H["Clean Report"]
```

**Output**: `{ biasDetected, biasTypes[], affectedGroups[], recommendation }`.

---

### Step 5 — Interview Guide Generation

```mermaid
flowchart TD
    A["User clicks<br/>Generate Interview Guide"] --> B{"Cached?"}
    B -->|Yes| C["Show cached<br/>questions instantly"]
    B -->|No| D["POST /api/interview/questions"]
    D --> E["interview.controller.js"]
    E --> F["callAI with<br/>INTERVIEW_PROMPT<br/>(maxTokens: 1400)"]
    F --> G["12 Tailored Questions"]
    G --> H["Cache in Zustand"]
    H --> C
```

**Question Categories**:

| Category | Count | Purpose |
|:---------|:-----:|:--------|
| Technical | 3 | Validate hard skills and domain knowledge |
| Behavioral | 3 | Assess soft skills and past performance |
| Gap-Probing | 3 | Explore weaknesses identified in scoring |
| Culture Fit | 3 | Evaluate values alignment and work style |

---

## AI Layer — Multi-Provider Gateway

All AI requests route through `llm.service.js`, which implements a resilient multi-provider gateway with automatic key rotation and cascading fallbacks:

```mermaid
flowchart TD
    A["callAI(prompt, content)"] --> B["Select Model Chain<br/>(Fast vs Quality tier)"]
    B --> C["Try Primary: Groq"]
    
    C --> D{"Success?"}
    D -->|Yes| K["safeParseJSON"]
    D -->|429| E["Rotate API Key"]
    E --> F{"More Keys?"}
    F -->|Yes| C
    F -->|No| G["Try Cerebras"]
    
    G --> H{"Success?"}
    H -->|Yes| K
    H -->|Fail| I["Try Gemini"]
    
    I --> J{"Success?"}
    J -->|Yes| K
    J -->|Fail| L["Try OpenRouter"]
    
    L --> K

    K --> M["Extract JSON<br/>(brace-matching scanner)"]
    M --> N["Return to Controller"]

    style A fill:#6366f1,color:#fff
    style K fill:#22c55e,color:#fff
    style N fill:#22c55e,color:#fff
```

### Model Tiers

| Tier | Use Case | Models | Rationale |
|:-----|:---------|:-------|:----------|
| **Fast** | JD/CV parsing | `llama-3.1-8b-instant` | Cheaper, lower latency for simpler extraction |
| **Quality** | Scoring, Bias, Interviews | `llama-3.3-70b-versatile`, `gpt-oss-120b` | Better reasoning for nuanced evaluation |

### Key Routing Principles

1. **Tier Isolation** — Fast and Quality tiers use different models on Groq. Since rate limits are per-model, this effectively doubles concurrent capacity.
2. **Instant Rotation on 429** — Comma-separated API keys (`GROQ_API_KEY=key1,key2`) are rotated automatically when rate limits are hit.
3. **Resilient JSON Parser** — The brace-matching scanner extracts valid JSON even when models output reasoning tokens or conversational filler before the payload.

---

## Backend Architecture

### Layer Diagram

```mermaid
graph TD
    subgraph Routing["Routing Layer"]
        R1["/api/auth"]
        R2["/api/jd"]
        R3["/api/cv"]
        R4["/api/score"]
        R5["/api/bias"]
        R6["/api/interview"]
        R7["/api/sessions"]
    end

    subgraph Middleware["Middleware Layer"]
        M1["auth.middleware.js<br/>(JWT Verification)"]
        M2["error.middleware.js<br/>(Global Error Handler)"]
        M3["upload.middleware.js<br/>(Multer File Handling)"]
    end

    subgraph Controllers["Controller Layer"]
        C1["auth.controller.js"]
        C2["jd.controller.js"]
        C3["cv.controller.js"]
        C4["score.controller.js"]
        C5["bias.controller.js"]
        C6["interview.controller.js"]
        C7["session.controller.js"]
    end

    subgraph Services["Service Layer"]
        S1["auth.service.js<br/>(bcrypt + JWT)"]
        S2["llm.service.js<br/>(AI Gateway)"]
        S3["parser.service.js<br/>(PDF/DOCX)"]
        S4["prompts.js<br/>(System Prompts)"]
        S5["openrouter.service.js<br/>(API Adapter)"]
    end

    subgraph Data["Data Layer"]
        D1[("PostgreSQL<br/>(Supabase)")]
        D2["SSE Job Store<br/>(In-Memory Map)"]
    end

    R1 --> C1
    R2 --> C2
    R3 --> C3
    R4 --> C4
    R5 --> C5
    R6 --> C6
    R7 --> M1 --> C7

    C1 --> S1
    C2 --> S2
    C3 --> S2
    C3 --> S3
    C4 --> S2
    C4 --> D2
    C5 --> S2
    C6 --> S2
    S2 --> S4
    S2 --> S5

    C1 --> D1
    C7 --> D1
```

### Route Mapping

| Route | Controller | Auth | Description |
|:------|:-----------|:----:|:------------|
| `/api/auth` | `auth.controller.js` | — | User registration and login |
| `/api/jd` | `jd.controller.js` | — | Job description parsing |
| `/api/cv` | `cv.controller.js` | — | CV batch upload and parsing |
| `/api/score` | `score.controller.js` | — | Batch scoring + SSE progress |
| `/api/bias` | `bias.controller.js` | — | Shortlist bias analysis |
| `/api/interview` | `interview.controller.js` | — | Interview guide generation |
| `/api/sessions` | `session.controller.js` | 🔒 | Screening session CRUD |

---

## Database Schema

```mermaid
erDiagram
    app_users {
        int id PK
        varchar email UK
        varchar password_hash
        varchar name
        timestamp created_at
    }

    screening_sessions {
        uuid id PK
        int user_id FK
        varchar title
        jsonb jd
        jsonb candidates
        jsonb bias_report
        jsonb interviews
        int candidate_count
        timestamp created_at
    }

    app_users ||--o{ screening_sessions : "owns"
```

- **`app_users`**: Stores registered users with bcrypt-hashed passwords
- **`screening_sessions`**: Persists complete screening sessions (JD, candidates, scores, bias reports, interview guides) as JSONB for flexible schema

---

## Frontend Architecture

```mermaid
graph TD
    subgraph App["App.jsx"]
        AUTH["AuthScreen"]
        subgraph Dashboard["Dashboard Layout"]
            SB["Sidebar<br/>(Navigation)"]
            subgraph Steps["Step Content"]
                S1["Step 1: JD Input"]
                S2["Step 2: CV Upload"]
                S3["Step 3: Scoring"]
                S4["Step 4: Results"]
                S5["Step 5: Interview<br/>(Inline Drawer)"]
            end
            HP["HistoryPanel<br/>(Slide-over)"]
        end
    end

    subgraph Stores["Zustand State"]
        AS["useAuthStore<br/>{ user, authReady,<br/>authLoading, authError }"]
        RS["useRecruitStore<br/>{ currentStep, parsedJD,<br/>parsedCandidates,<br/>rankedCandidates,<br/>biasReport, ... }"]
    end

    AUTH --> AS
    Dashboard --> RS
    Dashboard --> AS
```

### State Stores

#### `useAuthStore`

| Property | Type | Purpose |
|:---------|:-----|:--------|
| `user` | `Object` | Logged-in user info `{ id, email, name }` |
| `authReady` | `boolean` | LocalStorage JWT checked on boot |
| `authLoading` | `boolean` | Signup/login in progress |
| `authError` | `string` | Active auth error message |

#### `useRecruitStore`

| Property | Type | Purpose |
|:---------|:-----|:--------|
| `currentStep` | `number` | Active workflow step (1–4) |
| `parsedJD` | `Object` | Structured JD from AI |
| `parsedCandidates` | `Array` | Parsed candidate list |
| `isScoringActive` | `boolean` | SSE stream is active |
| `scoringProgress` | `number` | Progress percentage (0–100) |
| `rankedCandidates` | `Array` | Scored & sorted candidates |
| `biasReport` | `Object` | Shortlist bias analysis |
| `interviewQuestions` | `Object` | Cached guides by candidate name |
| `savedSessions` | `Array` | Past screening metadata |

---

## Key Design Decisions

| Decision | Rationale |
|:---------|:----------|
| **SSE over WebSockets** | Simpler server-side; unidirectional push is all scoring progress needs |
| **In-Memory Job Store** | Keeps SSE streaming fast without DB overhead; auto-saves to DB when scoring finishes |
| **PostgreSQL Session History** | Restoring past screenings solves state loss on restarts, enabling production use |
| **Multi-Provider LLM Fallback** | Ensures availability even when individual free-tier APIs go down |
| **API Key Pool Rotation** | Distributes load evenly, avoiding early rate-limit exhaustion |
| **Brace-Matching JSON Extractor** | Handles reasoning tokens and filler printed by models before JSON output |
| **Stateless JWT Auth** | Eliminates session-store DB queries, keeping routing fast and stateless |
| **Dual Zustand Stores** | Separates auth state from screening state for clean, focused modules |
| **Interview Question Cache** | Prevents redundant API calls when reopening candidate profiles |
| **Tier-Based Model Selection** | Fast tier for parsing, quality tier for scoring — maximizes throughput |
