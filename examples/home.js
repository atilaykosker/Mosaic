import Mosaic from '../src/index';

import './round-button';

import Logo from '../MosaicLogo.png';
import './home.css';

function depends(on) {
    if(on === true) return html`<h1>Conditional Working!!!</h1>`;
    else return html`<h2>Conditional is False Now!!!</h2>`;
}

export default new Mosaic({
    name: 'home-page',
    data: {
        on: false
    },
    created() {
        setInterval(() => {
            this.on = !this.on;
        }, 2000);
    },
    view() {
        return html`
        <img src='${Logo}' alt='mosaic logo'>
        
        <h1>Welcome to Mosaic!</h1>
        <h3>A front-end JavaScript library for building user interfaces!</h3>

        <p>
            This example application uses all of the main features of Mosaic
            in order to illustrate just how simple it is to get started with.
            To try out the different features, select the buttons below!
        </p>
        <p>
            For example, this entire demo application was written using
            the "Router" feature! Take a look at the "index.js" file to see
            how the router is being used to travel to other examples.
        </p>

        ${ depends.bind(null, this.on) }
        ${ html`<round-button title='Something' click='${() => console.log('printing something!!')}'></round-button>` }

        <round-button title='Todo Example'
            click='${() => this.router.send('/todo')}'></round-button>
        <round-button title='Portfolio Example'
            click='${() => this.router.send('/portfolio')}'></round-button>
        <round-button title='Delay Template Example'
            click='${() => this.router.send('/delaytemplate')}'></round-button>
        `
    }
});