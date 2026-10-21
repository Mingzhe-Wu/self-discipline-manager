module.exports = async function openTimetableDetails(page, taskId, title) {
    const card = page.locator(`.occurrence-card[data-task-id="${taskId}"]`).first();
    await card.scrollIntoViewIfNeeded();
    const details = card.getByRole('button', { name: `Details for ${title}`, exact: true });
    await details.focus();
    await details.press('Enter');
    await card.locator('.card-content').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
    await details.press('Enter');
};
