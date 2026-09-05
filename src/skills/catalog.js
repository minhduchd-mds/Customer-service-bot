const SKILLS = [
  {
    id: 'sales-assistant',
    intents: ['sales', 'pricing'],
    description: 'Qualify demand, answer product questions from known data, and capture a lead without inventing price or stock.'
  },
  {
    id: 'support-triage',
    intents: ['support', 'general'],
    description: 'Collect symptom, environment and impact; use knowledge sources; propose safe troubleshooting; escalate when unresolved.'
  },
  {
    id: 'order-care',
    intents: ['order-status'],
    description: 'Request a safe order reference and hand off to CRM/workflow. Never fabricate logistics or payment status.'
  },
  {
    id: 'human-handoff',
    intents: ['handoff'],
    description: 'Acknowledge the request, collect concise context, and route the conversation to a human workflow.'
  }
];

export function listSkills() {
  return SKILLS.map((skill) => ({ ...skill }));
}

export function selectSkill(intent) {
  return SKILLS.find((skill) => skill.intents.includes(intent)) || SKILLS[1];
}
