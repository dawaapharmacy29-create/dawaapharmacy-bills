export function branchReviewQueueForIncident(incident) {
  if (!incident) return 'shared';
  if (incident.side === 'sale') return incident.to || 'shared';
  if (incident.side === 'purchase') return incident.from || 'shared';
  return 'shared';
}

export function incidentMatchesBranchQueue(incident, queue = 'all') {
  if (queue === 'all') return true;
  return branchReviewQueueForIncident(incident) === queue;
}
