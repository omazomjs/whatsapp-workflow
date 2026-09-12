import readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';

export function promptPassword(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input, output, terminal: true });
    rl.question(question, (answer) => {
      rl.close();
      output.write('\n');
      resolve(answer);
    });
  });
}