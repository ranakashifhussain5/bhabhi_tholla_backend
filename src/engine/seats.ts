export function buildTurnOrder(
  playerCount: number,
  startSeat: number,
  escaped: readonly boolean[],
): number[] {
  const order: number[] = [];
  for (let i = 0; i < playerCount; i++) {
    const seat = (startSeat + i) % playerCount;
    if (!escaped[seat]) order.push(seat);
  }
  return order;
}
