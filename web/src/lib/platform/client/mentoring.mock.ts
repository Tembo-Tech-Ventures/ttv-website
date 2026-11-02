import {
  CreateMentorRequest, DeclineMentorRequest, MentorDirectoryQuery, MentorRequestListQuery, RedirectMentorRequest,
  ROUTES, UpdateMentorAvailability,
  type Id, type MentorAvailability, type MentorCapacity, type MentorDirectoryItem, type MentorRequest,
  type MentorRequestStatus, type PersonSummary, type ProjectEmbed,
} from "../contracts";
import * as fixtures from "../fixtures";
import { createApiClient, type ApiClient } from "./apiClient";
import { filterDirectoryFixture, hasOpenSpot } from "./mentor-directory";
import { createMockTransport, type MockOptions, type MockReply } from "./mockTransport";

/**
 * A stateful, in-memory mentor connections API over the shared synthetic
 * people (B-4.1's contract), for the DEV harness and the client tests. It
 * follows the contract's rules: a spot is held by each PENDING request and
 * each one accepted this month; a full mentor takes no new request (409) and
 * stays listed; one PENDING request per person and mentor (409); creating a
 * request needs the code of conduct (403 conduct_required); only PENDING
 * requests move, the mentor accepts, redirects or declines and the person
 * asking withdraws (409 otherwise). B-4.1's service stays the authority.
 */
export interface MentoringMockOptions extends MockOptions {
  /** Who is calling. Defaults to Wanjiku, a Cohort 04 builder. */
  viewer?: PersonSummary;
  /** Whether the viewer has agreed to how we talk to each other. Defaults to true. */
  conductAgreed?: boolean;
  /** Requests per page of GET /api/mentor-requests. Defaults to 20. */
  pageSize?: number;
}

export interface MentoringMock {
  api: ApiClient;
  requests(): MentorRequest[];
  availability(mentorId: Id): MentorAvailability;
  /** The viewer agrees to the habits, as the conduct form would record. */
  agreeConduct(): void;
  /** Plays the other side: a person withdraws, or a mentor answers, behind the viewer's back. */
  move(requestId: Id, status: Exclude<MentorRequestStatus, "PENDING">): void;
  /** The viewer's own projects, as the drawer offers them. */
  projects: ProjectEmbed[];
}

/** The start of December in Nairobi: when November's accepted requests stop holding spots. */
export const MOCK_NEXT_MONTH = Date.parse("2026-11-30T21:00:00Z");

const failure = (status: number, code: string, message: string): MockReply => ({ status, data: { error: { code, message } } });
const notFound = () => failure(404, "not_found", "Not found.");
const conflict = (message: string) => failure(409, "conflict", message);

const PROJECTS_BY_OWNER: Record<Id, ProjectEmbed[]> = {
  [fixtures.people.wanjiku.id]: [fixtures.projects.fareSplitter],
  [fixtures.people.achieng.id]: [fixtures.projects.chamaLedger],
};

function seedAvailability(item: MentorDirectoryItem): MentorAvailability {
  return {
    headline: item.headline, monthlyCapacity: item.capacity.limit, areas: [...item.areas], formats: [...item.formats],
    bio: item.bio, paused: false, listed: true, capacity: { ...item.capacity },
  };
}

export function createMentoringMock(options: MentoringMockOptions = {}): MentoringMock {
  const viewer = options.viewer ?? fixtures.people.wanjiku;
  const pageSize = options.pageSize ?? 20;
  let conductAgreed = options.conductAgreed ?? true;
  let sequence = 0;
  let clock = fixtures.FIXTURE_NOW;
  const tick = () => (clock += 1_000);

  const people = new Map<Id, PersonSummary>(Object.values(fixtures.people).map(person => [person.id, person]));
  const directory = new Map<Id, MentorDirectoryItem>(fixtures.mentors.items.map(item => [item.person.id, structuredClone(item)]));
  // David's own availability is the fixture's; the other mentors' follow their directory cards.
  const availability = new Map<Id, MentorAvailability>([...directory.values()].map(item => [
    item.person.id, item.person.id === fixtures.people.david.id ? structuredClone(fixtures.availability) : seedAvailability(item),
  ]));
  let requests: MentorRequest[] = structuredClone([
    fixtures.pendingMentorRequest, fixtures.brianMentorRequest, fixtures.acceptedMentorRequest,
  ]);

  /** Spots held this month: the fixtures' counts, plus requests made or moved here. */
  const held = new Map<Id, number>([...availability].map(([id, saved]) => [id, saved.capacity.used]));
  const capacityOf = (mentorId: Id): MentorCapacity => {
    const limit = availability.get(mentorId)?.monthlyCapacity ?? 0;
    const used = held.get(mentorId) ?? 0;
    return { used, limit, nextOpeningAt: used >= limit && limit > 0 ? MOCK_NEXT_MONTH : null };
  };
  const listed = (mentorId: Id) => {
    const saved = availability.get(mentorId);
    return Boolean(saved && saved.headline.trim() && !saved.paused && saved.monthlyCapacity > 0);
  };
  const directoryItem = (mentorId: Id): MentorDirectoryItem | null => {
    const saved = availability.get(mentorId);
    const person = people.get(mentorId);
    if (!saved || !person || !listed(mentorId)) return null;
    return {
      person, headline: saved.headline, areas: saved.areas, formats: saved.formats, bio: saved.bio,
      capacity: capacityOf(mentorId), paused: false,
    };
  };
  const ownAvailability = (mentorId: Id): MentorAvailability => {
    const saved = availability.get(mentorId) ?? {
      headline: "", monthlyCapacity: 0, areas: [], formats: [...fixtures.mentors.items[0].formats], bio: "", paused: false,
      listed: false, capacity: { used: 0, limit: 0, nextOpeningAt: null },
    };
    return { ...saved, listed: listed(mentorId), capacity: capacityOf(mentorId) };
  };

  const find = (id: string) => requests.find(request => request.id === id);
  const visible = (request: MentorRequest) => request.requester.id === viewer.id || request.mentor.id === viewer.id;
  const update = (id: Id, change: Partial<MentorRequest>): MentorRequest => {
    requests = requests.map(request => request.id === id ? { ...request, ...change, updatedAt: tick() } : request);
    return find(id)!;
  };
  const release = (request: MentorRequest) => held.set(request.mentor.id, Math.max(0, (held.get(request.mentor.id) ?? 0) - 1));

  /** Moves a PENDING request, as its mentor (`by: "mentor"`) or the person asking. */
  function transition(id: string, by: "mentor" | "requester", change: (request: MentorRequest) => Partial<MentorRequest> | MockReply): MockReply {
    const request = find(id);
    if (!request || !visible(request)) return notFound();
    const actor = by === "mentor" ? request.mentor.id : request.requester.id;
    if (actor !== viewer.id) return failure(403, "forbidden", "Not yours to answer.");
    if (request.status !== "PENDING") return conflict("This request has already moved on.");
    const next = change(request);
    if ("data" in next) return next as MockReply;
    return { data: update(request.id, next) };
  }

  const api = createApiClient({ retry: { maxRetries: 0 }, fetch: createMockTransport([
    { ...ROUTES.listMentors, reply: ({ request }) => {
      const url = new URL(request.url);
      const query = MentorDirectoryQuery.parse(Object.fromEntries(url.searchParams));
      const items = [...availability.keys()].filter(id => id !== viewer.id)
        .map(directoryItem).filter((item): item is MentorDirectoryItem => item !== null);
      return { data: { items: filterDirectoryFixture(items, { area: query.area ?? null, format: query.format ?? null, available: query.available ?? false }) } };
    } },
    { ...ROUTES.listMentorRequests, reply: ({ request }) => {
      const url = new URL(request.url);
      const query = MentorRequestListQuery.parse(Object.fromEntries(url.searchParams));
      const mine = requests
        .filter(item => (query.as === "mentor" ? item.mentor.id : item.requester.id) === viewer.id)
        .filter(item => !query.status || item.status === query.status)
        .toSorted((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
      const start = query.cursor ? Number(query.cursor) : 0;
      const page = mine.slice(start, start + pageSize);
      return { data: { items: page, nextCursor: start + pageSize < mine.length ? String(start + pageSize) : null } };
    } },
    { ...ROUTES.getMentorRequest, reply: ({ params }) => {
      const request = find(params.id);
      return request && visible(request) ? { data: request } : notFound();
    } },
    { ...ROUTES.createMentorRequest, reply: async ({ request }) => {
      const body = CreateMentorRequest.parse(await request.json());
      if (!conductAgreed) return failure(403, "conduct_required", "Agree to how we talk to each other first.");
      const mentor = directoryItem(body.mentorId);
      if (!mentor || body.mentorId === viewer.id) return notFound();
      if (!mentor.formats.includes(body.format)) return failure(400, "validation_error", "That mentor doesn't offer this format.");
      if (requests.some(item => item.status === "PENDING" && item.requester.id === viewer.id && item.mentor.id === body.mentorId)) {
        return conflict("You already have a request waiting with this mentor.");
      }
      if (!hasOpenSpot(mentor)) return conflict("This mentor is full this month.");
      const project = body.project && (PROJECTS_BY_OWNER[viewer.id] ?? []).find(item => item.journeyId === body.project!.journeyId && item.version === body.project!.version);
      if (body.project && !project) return failure(400, "validation_error", "Attach one of your own published projects.");
      const now = tick();
      const created: MentorRequest = {
        id: `mock-request-${++sequence}`, requester: viewer, mentor: mentor.person, note: body.note, project: project ?? null,
        format: body.format, status: "PENDING", channelId: null, redirectedTo: null, responseNote: null, createdAt: now, updatedAt: now,
      };
      requests = [created, ...requests];
      held.set(body.mentorId, (held.get(body.mentorId) ?? 0) + 1);
      return { status: 201, data: created };
    } },
    { ...ROUTES.acceptMentorRequest, reply: ({ params }) => transition(params.id, "mentor", request => ({
      status: "ACCEPTED",
      channelId: request.requester.id === fixtures.people.wanjiku.id && request.mentor.id === fixtures.people.david.id
        ? fixtures.channels.davidConversation.id : `mock-dm-${request.id}`,
    })) },
    { ...ROUTES.redirectMentorRequest, reply: async ({ params, request: http }) => {
      const body = RedirectMentorRequest.parse(await http.json());
      return transition(params.id, "mentor", request => {
        const target = directoryItem(body.mentorId);
        if (!target || target.person.id === request.requester.id || target.person.id === request.mentor.id) {
          return failure(400, "validation_error", "Suggest another listed mentor.");
        }
        release(request);
        return { status: "REDIRECTED", redirectedTo: target.person, responseNote: body.note ?? null };
      });
    } },
    { ...ROUTES.declineMentorRequest, reply: async ({ params, request: http }) => {
      const body = DeclineMentorRequest.parse(await http.json());
      return transition(params.id, "mentor", request => {
        release(request);
        return { status: "DECLINED", responseNote: body.note ?? null };
      });
    } },
    { ...ROUTES.withdrawMentorRequest, reply: ({ params }) => transition(params.id, "requester", request => {
      release(request);
      return { status: "WITHDRAWN" };
    }) },
    { ...ROUTES.getMentorAvailability, reply: () => ({ data: ownAvailability(viewer.id) }) },
    { ...ROUTES.updateMentorAvailability, reply: async ({ request }) => {
      const body = UpdateMentorAvailability.parse(await request.json());
      availability.set(viewer.id, { ...body, listed: false, capacity: capacityOf(viewer.id) });
      return { data: ownAvailability(viewer.id) };
    } },
  ], options) });

  return {
    api,
    requests: () => structuredClone(requests),
    availability: (mentorId: Id) => ownAvailability(mentorId),
    agreeConduct() { conductAgreed = true; },
    move(requestId, status) {
      const request = find(requestId);
      if (!request || request.status !== "PENDING") return;
      if (status !== "ACCEPTED") release(request);
      update(requestId, {
        status,
        ...(status === "ACCEPTED" ? { channelId: `mock-dm-${requestId}` } : {}),
        ...(status === "REDIRECTED" ? { redirectedTo: fixtures.people.joseph } : {}),
      });
    },
    projects: structuredClone(PROJECTS_BY_OWNER[viewer.id] ?? []),
  };
}
