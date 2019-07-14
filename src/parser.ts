import { MosaicComponent, ViewFunction } from "./options";
import { lastAttributeNameRegex, nodeMarker, traverse, changed, step } from "./util";
import Memory from "./memory";

/** Finds or creates the template associated with a component. */
export function getTemplate(component: MosaicComponent): HTMLTemplateElement {
    const found = document.getElementById(component.tid) as HTMLTemplateElement;
    if(found) return found;
    else {
        if(!component.view) return document.createElement('template');
        const { strings } = component.view(component);
        const template = document.createElement('template');
        template.id = component.tid;
        template.innerHTML = buildHTML(strings);
        (template as any).memories = memorize.call(template);
        return template;
    }
}

/** Renders a One Time Template. Still requires repainting. */
export function OTT(view: ViewFunction, key?: string) {
    // Create and memorize the template.
    const template = document.createElement('template');
    template.innerHTML = buildHTML(view.strings);
    (template as any).memories = memorize.call(template);
    
    // Repaint the template with its memories.
    const parser = new DOMParser();
    const parsed = parser.parseFromString(template.innerHTML, 'text/html');
    const instance = parsed.body.firstChild as HTMLElement;
    (instance as any).isOTT = true;
    
    if(key) instance.setAttribute('key', key);
    return {
        instance,
        values: view.values,
        memories: (template as any).memories,
    };
}

/** A global repaint function, which can be used for templates and components. */
export function _repaint(element: HTMLElement, memories: Memory[], oldValues: any[], newValues: any[]) {
    const isOTT: boolean = (element as any).isOTT === true;

    for(let i = 0; i < memories.length; i++) {
        const mem: Memory = memories[i];
        const pointer = isOTT === true ? element : step(element, mem.config.steps);
        
        // Get the old and new values.
        let oldv = oldValues[i];
        let newv = newValues[i];

        // For conditional rendering.
        let alwaysUpdateFunction = mem.config.type === 'node';

        // Compare and commit.
        if(changed(oldv, newv, alwaysUpdateFunction))
            mem.commit(element, pointer, oldv, newv);
    }
}

/** Takes the strings of a tagged template literal and 
* turns it into a full html string. */
export function buildHTML(strings) {
    let html = '';
    const length = strings.length - 1;

    for(let i = 0; i < length; i++) {
        const str = strings[i];
        const attributeMatch = lastAttributeNameRegex.exec(str);
        
        // Node.
        if(attributeMatch === null) html += str + nodeMarker;
        // Attribute.
        else html += str.substring(0, attributeMatch.index) + attributeMatch[1] +
            attributeMatch[2] + attributeMatch[3] + nodeMarker;
    }
    html += strings[length];
    return html;
}

/** Memorizes parts of a DOM tree that contain dynamic content
* and returns a list of memories of whether those parts are. */
export function memorize() {
    let ret: any[] = [];
    const fragment: HTMLTemplateElement = document.importNode(this, true);
    traverse(fragment.content, (node: Element, steps: number[]) => {
        // console.dir(node);
        switch(node.nodeType) {
            case 1: ret = ret.concat(parseAttributes(node, steps)); break;
            case 8: ret = ret.concat(parseNode(node as any, steps)); break;
            default: break;
        }
    });
    return ret;
}

// Helper functions to parse attributes, nodes, and text.
function parseAttributes(node: Element, steps: number[]): Memory[] {
    if(!node.attributes) return [];
    let ret: Memory[] = [];
    const defined = customElements.get(node.nodeName.toLowerCase()) !== undefined;
    
    const regex = new RegExp(`[a-z|A-Z| ]*${nodeMarker}[a-z|A-Z| ]*`, 'g');
    for(let i = 0; i < node.attributes.length; i++) {
        const { name, value } = node.attributes[i];
        const match = value.match(regex);
        // console.log(name, value, match);
        if(!match || match.length < 1) continue;
        
        // Split the value to see where the dynamic parts in the string are.
        const split = (name === 'style' ? value.split(';') : value.split(' '))
            .filter(str => str.length > 0);
        for(let j = 0; j < split.length; j++) {
            const item = split[j];
            const isDynamic = item === nodeMarker;

            // Make sure you only add memories for dynamic attributes.
            if(isDynamic) {
                ret.push(new Memory({
                    type: 'attribute',
                    steps,
                    isComponentType: defined,
                    isEvent: name.startsWith('on'),
                    attribute: { name },
                }));
            }
        }
    }
    return ret;
}
function parseNode(node: Text, steps: number[]): Memory[] {
    const check = nodeMarker.replace('<!--','').replace('-->','');
    if(node.textContent !== check) return [];

    let defined = customElements.get(node.nodeName.toLowerCase()) !== undefined;
    let defined2 = false;
    if(node.parentElement)
        defined2 = customElements.get(node.parentElement.nodeName.toLowerCase()) !== undefined;
    
    return [new Memory({
        type: "node",
        steps,
        isComponentType: defined || defined2
    })];
}