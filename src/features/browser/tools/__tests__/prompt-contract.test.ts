import { readFileSync } from 'fs';
import path from 'path';

describe('AgentRuntime prompt contract', () => {
  it('instructs the model to use short refs instead of DOM ids', () => {
    const filePath = path.resolve(
      __dirname,
      '../../../../../modules/agent-runtime/ios/AgentRuntimePromptBuilder.swift',
    );
    const source = readFileSync(filePath, 'utf8');

    expect(source).toContain('exact short ref value (e.g. "e1")');
    expect(source).not.toContain('e.g. "ai-main-abc-123"');
    expect(source).toContain(
      'If typing into a field has no effect, try clicking or focusing the field, then observe again.',
    );
    expect(source).toContain('Current phase:');
    expect(source).toContain('Active todo:');
    expect(source).toContain('Todos:');
    expect(source).toContain('Avoid for now:');
    expect(source).toContain('"plan_updates"');
    expect(source).toContain('Read the current todo list before each step.');
    expect(source).toContain('The first image is always the current viewport.');
    expect(source).toContain('Why richer context was requested:');
    expect(source).toContain('Use the overview image to understand page layout and off-screen content');
  });
});
