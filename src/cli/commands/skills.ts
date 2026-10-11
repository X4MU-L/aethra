/**
 * `aethra skills` — manage and validate agent skills.
 */

import type { Command } from 'commander';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { listAllSkills, validateSkill } from '../../skills/manager.js';
import { readFile, pathExists, listDir } from '../../engine/fs.js';
import { logger } from '../../core/logger.js';
import { toAethraError } from '../../core/errors.js';

const AETHRA_SKILLS_DIR = path.join(os.homedir(), '.aethra', 'skills');

export function registerSkillsCommand(program: Command): void {
  const skills = program
    .command('skills')
    .description('Manage and validate agent skills');

  // aethra skills list
  skills
    .command('list')
    .description('List all available skills')
    .option('--json', 'Output as JSON')
    .action(async (opts, cmd) => {
      try {
        // listAllSkills already includes the global ~/.aethra/skills dir
        // Only pass projectSkillsDir if it's a different directory (e.g. inside a client workspace)
        const allSkills = await listAllSkills();

        if (opts.json || cmd.parent?.parent?.opts()?.json) {
          console.log(JSON.stringify(allSkills.map((s) => s.metadata), null, 2));
          return;
        }

        console.log(chalk.bold.blue('\n  Available skills\n'));

        if (allSkills.length === 0) {
          console.log(chalk.gray('  No skills found.'));
          console.log(chalk.gray(`  Skills directory: ${AETHRA_SKILLS_DIR}`));
          console.log(chalk.gray('  Run: aethra init to install built-in skills'));
          return;
        }

        const byCategory = new Map<string, typeof allSkills>();
        for (const skill of allSkills) {
          const cat = skill.metadata.category;
          if (!byCategory.has(cat)) byCategory.set(cat, []);
          byCategory.get(cat)!.push(skill);
        }

        for (const [category, categorySkills] of byCategory) {
          console.log(chalk.bold(`  ${category}\n`));
          for (const skill of categorySkills) {
            const statusColor =
              skill.metadata.status === 'approved'
                ? chalk.green
                : skill.metadata.status === 'experimental'
                ? chalk.yellow
                : chalk.gray;
            console.log(
              `  ${statusColor(`[${skill.metadata.status}]`)} ${chalk.bold(skill.metadata.name)} v${skill.metadata.version}`,
            );
            console.log(chalk.gray(`    ${skill.metadata.description}`));
            console.log(chalk.gray(`    Source: ${skill.source} | ${skill.filePath}`));
            console.log();
          }
        }
      } catch (err) {
        logger.error(`skills list failed: ${(toAethraError(err)).message}`);
        process.exit(1);
      }
    });

  // aethra skills validate
  skills
    .command('validate [skill-file]')
    .description('Validate a skill file or all skills in the skills directory')
    .action(async (skillFile?: string) => {
      try {
        const filesToValidate: string[] = [];

        if (skillFile) {
          filesToValidate.push(path.resolve(process.cwd(), skillFile));
        } else {
          if (await pathExists(AETHRA_SKILLS_DIR)) {
            const entries = await listDir(AETHRA_SKILLS_DIR);
            for (const entry of entries) {
              if (entry.endsWith('.md')) {
                filesToValidate.push(path.join(AETHRA_SKILLS_DIR, entry));
              }
            }
          }
        }

        if (filesToValidate.length === 0) {
          console.log(chalk.yellow('  No skill files found to validate.'));
          return;
        }

        console.log(chalk.bold.blue(`\n  Validating ${filesToValidate.length} skill(s)\n`));

        let allValid = true;
        for (const filePath of filesToValidate) {
          const content = await readFile(filePath);
          const result = validateSkill(content, filePath);

          const icon = result.valid ? chalk.green('✓') : chalk.red('✗');
          console.log(`  ${icon} ${path.basename(filePath)}`);

          for (const err of result.errors) {
            console.log(chalk.red(`      Error: ${err}`));
            allValid = false;
          }
          for (const warn of result.warnings) {
            console.log(chalk.yellow(`      Warning: ${warn}`));
          }
        }

        if (allValid) {
          console.log(chalk.green('\n  ✓ All skills valid.\n'));
        } else {
          console.log(chalk.red('\n  ✗ Some skills have errors.\n'));
          process.exit(1);
        }
      } catch (err) {
        logger.error(`skills validate failed: ${(toAethraError(err)).message}`);
        process.exit(1);
      }
    });
}
