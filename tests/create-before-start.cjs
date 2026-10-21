/** Historical fixtures represent a task created before its schedule, followed
 * by time passing. This never bypasses the production creation validation. */
module.exports = function createBeforeStart(service, input) {
    const currentTime = Date.now();
    const creationTime = input.scheduleType === 'one-time' ? Math.min(currentTime, input.scheduledStartAt - 1) : currentTime;
    Date.now.mock.mockImplementation(() => creationTime);
    try { return service.createTask(input); }
    finally { Date.now.mock.mockImplementation(() => currentTime); }
};
