import { MosaicComponent, ViewFunction, BatchUpdate } from "./options";
import { lastAttributeNameRegex, nodeMarker, traverse, changed, step, objectFromArray } from "./util";
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

    const instance = document.importNode(template.content, true).firstChild as HTMLElement;
    if(key) instance.setAttribute('key', key);
    
    return {
        instance,
        values: view.values,
        memories: (template as any).memories,
    };
}

/** A global repaint function, which can be used for templates and components. */
export function _repaint(element: HTMLElement, memories: Memory[], oldValues: any[], newValues: any[], isOTT: boolean = false) {
    let nestedNodes: Object = {};

    for(let i = 0; i < memories.length; i++) {
        const mem: Memory = memories[i];

        // Get the reference to the true node that you are pointing at.
        // We have to splice the array for OTTs because they do not have
        // a holding container such as <custom-element>.
        let pointer;
        if((element as any).useShadow === true && (element as any).shadowRoot) {
            const host = (element as any).shadowRoot;
            const regularSteps = mem.config.steps.slice();
            pointer = step(host, regularSteps);
        }
        else if(isOTT === true) {
            const OTTsteps = mem.config.steps.slice();
            OTTsteps.splice(0, 1);
            pointer = step(element, OTTsteps);
        } else {
            const regularSteps = mem.config.steps.slice();
            pointer = step(element, regularSteps);
        }
        
        // Get the old and new values.
        let oldv = oldValues[i];
        let newv = newValues[i];
        
        // For conditional rendering.
        let alwaysUpdateFunction = mem.config.type === 'node';
        
        // Compare and commit.
        if(changed(oldv, newv, alwaysUpdateFunction))
            mem.commit(element, pointer, oldv, newv, nestedNodes);
    }

    // Go through the immediately nested nodes and update them with the
    // new data, while also sending over the parsed attributes. Then
    // clear the batch when you are done.
    const keys = Object.keys(nestedNodes);
    for(let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const component = nestedNodes[key] as MosaicComponent;
        const justData = objectFromArray(component.batches.data);
        const justAttrs = objectFromArray(component.batches.attributes);
        
        if(component.received && component.batches.attributes.length > 0)
            component.received(justAttrs);
        if(component.batches.data.length > 0) component.set(justData);

        component.batches = { attributes: [], data: [] };
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