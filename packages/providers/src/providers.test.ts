import { CATALOG, DEFAULT_MODEL, type RoomModelChoice } from './index';

describe('catalog', () => {
  it('the default model is a free mock model that exists in the catalog', () => {
    const model = CATALOG[DEFAULT_MODEL.kind].find((m) => m.id === DEFAULT_MODEL.model);
    expect(model?.free).toBe(true);
  });

  it('a room model choice has no field that could hold a key', () => {
    const choice: RoomModelChoice = { ...DEFAULT_MODEL };
    expect(Object.keys(choice).sort()).toEqual(['kind', 'model']);
  });
});
