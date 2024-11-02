import YAML from 'yaml';

export function parseYaml(yamlContent) {
    return YAML.parse(yamlContent);
}