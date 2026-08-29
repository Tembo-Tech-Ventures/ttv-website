/**
 * Mock data for the chat-layout prototypes under `/dev/chat-proto/*`.
 *
 * These prototypes exist to compare navigation/scroll structures, not to
 * exercise retrieval, so the content is fixed and deliberately long enough to
 * overflow a phone viewport — a chat layout only reveals its scroll problems
 * once the transcript is taller than the screen.
 */

export interface MockCitation {
  sourceNumber: number;
  recordingId: string;
  title: string;
  startTime: number;
  text: string;
}

export interface MockMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: MockCitation[];
}

export interface MockConversation {
  id: string;
  title: string;
  latestMessage: string;
  messageCount: number;
  /** Pre-formatted so prototypes render identically on every run. */
  updatedLabel: string;
}

export const MOCK_CONVERSATIONS: MockConversation[] = [
  {
    id: "c-discovery",
    title: "Customer discovery next steps",
    latestMessage: "Validate the problem with short interviews before building anything.",
    messageCount: 8,
    updatedLabel: "Today, 09:24",
  },
  {
    id: "c-architecture",
    title: "Architecture tradeoffs for the MVP",
    latestMessage: "Keep it boring until retrieval quality is proven.",
    messageCount: 12,
    updatedLabel: "Yesterday, 16:02",
  },
  {
    id: "c-pitch",
    title: "Feedback on the demo day pitch",
    latestMessage: "Lead with the traction slide, not the architecture diagram.",
    messageCount: 5,
    updatedLabel: "Mon, 11:47",
  },
  {
    id: "c-pricing",
    title: "How mentors framed pricing",
    latestMessage: "Charge for the outcome, not the seat.",
    messageCount: 6,
    updatedLabel: "Fri, 14:10",
  },
  {
    id: "c-hiring",
    title: "Hiring the first engineer",
    latestMessage: "Hire for range before depth at this stage.",
    messageCount: 4,
    updatedLabel: "Thu, 10:33",
  },
  {
    id: "c-legacy",
    title: "Earlier discussion",
    latestMessage: "Questions asked before chats were saved separately.",
    messageCount: 3,
    updatedLabel: "Mar 14",
  },
];

export const MOCK_MESSAGES: MockMessage[] = [
  {
    id: "m1",
    role: "user",
    content: "What should we do before building the MVP?",
  },
  {
    id: "m2",
    role: "assistant",
    content:
      "Validate the problem before you build. The sequence mentors kept coming back to was:\n\n- Run short customer interviews — fifteen minutes is enough.\n- Look for a repeated pain point, not a single strong opinion.\n- Narrow the MVP to the smallest workflow that tests your riskiest assumption. [1]\n\nThe common failure mode is building the second version of something nobody asked for.",
    citations: [
      {
        sourceNumber: 1,
        recordingId: "recording-1",
        title: "Mentor Hours: Customer Discovery",
        startTime: 384,
        text: "Before you build, talk to customers and check whether this is a repeated problem they already try to solve.",
      },
    ],
  },
  {
    id: "m3",
    role: "user",
    content: "How many interviews is enough to be confident?",
  },
  {
    id: "m4",
    role: "assistant",
    content:
      "There is no magic number, but the sessions gave a practical stopping rule: keep going until two or three consecutive interviews stop surprising you. In practice that landed between eight and twelve people for most teams in the cohort. [1]\n\nTwo cautions came up repeatedly:\n\n- Interviewing people who are easy to reach is not the same as interviewing your buyer.\n- If everyone is enthusiastic and nobody has tried to solve the problem already, that enthusiasm is probably politeness.",
    citations: [
      {
        sourceNumber: 1,
        recordingId: "recording-3",
        title: "Mentor Hours: Talking to Users",
        startTime: 902,
        text: "You stop when you stop being surprised. For most of you that is somewhere around ten conversations.",
      },
    ],
  },
  {
    id: "m5",
    role: "user",
    content: "And what about the architecture? We keep going back and forth on the stack.",
  },
  {
    id: "m6",
    role: "assistant",
    content:
      "The workshop was blunt about this: the architecture is not your risk yet.\n\n1. Pick the stack your team can already ship in.\n2. Prove the riskiest assumption — usually retrieval or data quality — with the simplest thing that works.\n3. Only then spend a week on structure. [1]\n\nThe cost argument mattered too: a managed service that costs more per month than the whole rest of the stack is a decision you will have to unwind later. [2]",
    citations: [
      {
        sourceNumber: 1,
        recordingId: "recording-2",
        title: "Technical Architecture Workshop",
        startTime: 1020,
        text: "The MVP should prove the riskiest assumption first, not include every planned feature.",
      },
      {
        sourceNumber: 2,
        recordingId: "recording-2",
        title: "Technical Architecture Workshop",
        startTime: 1494,
        text: "If one line item is bigger than everything else combined, that is a decision you will have to undo.",
      },
    ],
  },
  {
    id: "m7",
    role: "user",
    content: "Summarise the action items for our team.",
  },
  {
    id: "m8",
    role: "assistant",
    content:
      "**This week**\n\n- Book eight discovery interviews; write the five questions before the first call.\n- Freeze the stack. No further evaluation until the interviews are done.\n\n**Next week**\n\n- Write up the repeated pain points, one line each, with a quote.\n- Cut the MVP scope to the single workflow those quotes justify. [1]",
    citations: [
      {
        sourceNumber: 1,
        recordingId: "recording-1",
        title: "Mentor Hours: Customer Discovery",
        startTime: 1580,
        text: "Come back next week with quotes, not with a feature list.",
      },
    ],
  },
];

export const EXAMPLE_PROMPTS = [
  "What were the main action items from mentor hours?",
  "Explain the advice about customer interviews.",
  "Where did we discuss architecture tradeoffs?",
];

export const APP_NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/sessions", label: "Sessions" },
  { href: "/dashboard/portfolio", label: "Portfolio" },
  { href: "/dashboard/profile", label: "Profile" },
];
