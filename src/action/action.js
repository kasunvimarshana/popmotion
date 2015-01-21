"use strict";

var cycl = require('cycl'),
    processor = require('./processor.js'),
    presets = require('./presets.js'),
    rubix = require('./rubix.js'),
    Pointer = require('../input/pointer.js'),
    KEY = require('../opts/keys.js'),
    defaultProps = require('../opts/props.js'),
    defaultValue = require('../opts/value.js'),
    calc = require('../utils/calc.js'),
    utils = require('../utils/utils.js'),
    Value = require('../types/value.js'),
    Repo = require('../types/repo.js'),

    Action = function (def, override) {
        var self = this;
        
        // Create value manager
        self.values = new Repo();
        
        // Create new property manager
        self.props = new Repo(defaultProps);

        // Create data store
        self.data = new Repo();
        
        // Register process wth cycl
        self.process = cycl.newProcess(function (framestamp, frameDuration) {
	        if (self.active) {
            	processor.action(self, framestamp, frameDuration);
	        }
        });
        
        self.set(def, override);
    };

Action.prototype = {

    // [number]: Progress represented in a range of 0 - 1
    progress: 0,
    
    // [number]: Time elapsed in ms
    elapsed: 0,

    /*
        Play the provided actions as animations
        
        Syntax
            .play(playlist, [override])
                @param [string]: Playlist of presets
                @param [object]: (optional) Override object
                
            .play(params)
                @param [object]: Action properties
                
        @return [Action]
    */
    play: function (defs, override) {
        this.set(defs, override);
        return this.start(KEY.RUBIX.TIME);
    },

    /*
        Run Action indefinitely
        
        Syntax
            .run(preset, [override])
                @param [string]: Name of preset
                @param [object]: (optional) Override object
                
            .run(params)
                @param [object]: Action properties
                
        @return [Action]
    */
    run: function (defs, override) {
        this.set(defs, override);
        return this.start(KEY.RUBIX.RUN);
    },
    
    /*
        Track values to mouse, touch or custom Input
        
        Syntax
            .track(preset, [override], input)
                @param [string]: Name of preset
                @param [object]: (optional) Override object
                @param [event || Input]: Input or event to start tracking
                
            .track(params, input)
                @param [object]: Action properties
                @param [event || Input]: Input or event to start tracking
                
        @return [Action]
    */
    track: function () {
        var args = arguments,
            argLength = args.length,
            defs, override, input;
        
        // Loop backwards over arguments
        for (var i = argLength - 1; i >= 0; i--) {
            if (args[i] !== undefined) {
                // If input hasn't been defined, this is the input
                if (input === undefined) {
                    input = args[i];

                // Or if this is the second argument, these are overrides
                } else if (i === 1) {
                    override = args[i];
                    
                // Otherwise these are the defs
                } else if (i === 0) {
                    defs = args[i];
                }
            }
        }

        if (!input.current) {
            input = new Pointer(input);
        }

        this.set(defs, override, input);

        return this.start(KEY.RUBIX.INPUT);
    },
 /*   
    fire: function (progress) {
        var rubix = this.props.get('rubix'),
            isActive = this.process.isActive;

        if (utils.isNum(progress)) {
            this.progress = progress;
        }
        
        this.changeRubix(KEY.RUBIX.FIRE);
        this.isActive(true);
        this.process.activate().fire();

        if (isActive) {
            this.props.set('rubix', rubix);
        } else {
            this.isActive(false);
            this.process.deactivate();
        }

        return this;
   },
     */
    /*
        Start Action

        @param [string]: Name of processing type to use
        @return [Action]
    */
    start: function (processType) {
	    var self = this;

        self.resetProgress();
        
        if (processType) {
            self.changeRubix(processType);
        }

        self.isActive(true);
        self.started = utils.currentTime() + self.props.get('delay');
        self.framestamp = self.started;
        self.firstFrame = true;
        
        self.process.start();
        
        return self;
    },
    
    /*
        Stop current Action process
    */
    stop: function () {
	    var self = this;

        self.isActive(false);
        self.process.stop();

        return self;
    },
    
    /*
        Pause current Action
    */
    pause: function () {
	    this.stop();
	    
	    return this;
    },
    
    /*
        Resume a paused Action
    */
    resume: function () {
	    var self = this;
	    
        self.started = utils.currentTime();
        self.framestamp = self.started;
        self.isActive(true);
        
        self.process.start();
        
        return self;
    },
    
    /*
        Reset Action progress and values
    */
    reset: function () {
	    var self = this,
	        values = self.values.get();

        self.resetProgress();
        
        for (var key in values) {
            values[key].reset();
        }
        
        return self;
    },
    
    /*
	    Reset Action progress
    */
    resetProgress: function () {
	    var self = this;

        self.progress = 0;
        self.elapsed = 0;
        self.started = utils.currentTime();
        
        return self;
    },
    
    /*
	    Reverse Action progress and values
    */
    reverse: function () {
	    var self = this,
	        values = self.values.get();
	    
	    self.progress = calc.difference(self.progress, 1);
        self.elapsed = calc.difference(self.elapsed, self.props.get('duration'));
        
        for (var key in values) {
            values[key].reverse();
        }

        return self;
    },
    
    toggle: function () {
        if (this.isActive()) {
            this.pause();
        } else {
            this.resume();
        }
    },
    
    /*
        Check for next steps and perform, stop if not
    */
    next: function () {
        var self = this,
            nexts = [{
                key: 'loop',
                callback: self.reset
            }, {
                key: 'yoyo',
                callback: self.reverse
            }],
            possibles = nexts.length,
            hasNext = false;
            
        for (var i = 0; i < possibles; ++i) {
            if (self.checkNextStep(nexts[i].key, nexts[i].callback)) {
                hasNext = true;
                break;
            }
        }

        if (!hasNext && !self.playNext()) {
            self.stop();
        }
        
        return self;
    },
    
    /*
        Check next step
        
        @param [string]: Name of step ('yoyo' or 'loop')
        @param [callback]: Function to run if we take this step
    */
    checkNextStep: function (key, callback) {
        var stepTaken = false,
            step = this.props.get(key),
            count = this.props.get(key + 'Count'),
            forever = (step === true);

        if (forever || utils.isNum(step)) {
            ++count;
            this.props.set(key + 'Count', count);
            if (forever || count <= step) {
                callback.call(this);
                stepTaken = true;
            }
        }

        return stepTaken;
    },
    
    /*
        Next in playlist
    */
    playNext: function () {
        var stepTaken = false,
            playlist = this.props.get('playlist'),
            playlistLength = playlist.length,
            playhead = this.props.get('playhead'),
            next = {};

        // Check we have a playlist
        if (playlistLength > 1) {
            ++playhead;
            
            if (playhead < playlistLength) {
                next = presets.getDefined(playlist[playhead]);
                next.playhead = playhead;
                this.set(next);
                this.reset();
                stepTaken = true;
            }
        }

        return stepTaken;
    },
    
    /*
        Set Action values and properties
        
        Syntax
            .set(preset[, override, input])
                @param [string]: Name of preset to apply
                @param [object] (optional): Properties to override preset
            
            .set(params[, input])
                @param [object]: Action properties
            
        @return [Action]
    */
    set: function (defs, override, input) {
        var self = this,
            validDefinition = (defs !== undefined),
            base = {},
            values = {},
            jQueryElement = self.data.get(KEY.JQUERY_ELEMENT);

        if (validDefinition) {
            base = presets.createBase(defs, override);
            
            if (input !== undefined) {
                base.input = input;
                base.inputOrigin = input.get();
            }
            
            // Set scope if jQuery element
            if (jQueryElement) {
                base.scope = jQueryElement;
            }

            self.props.set(base);
            self.setValues(base.values, self.props.get());
            
            values = self.values.get();
            
            // Create origins
            self.origin = {};
            for (var key in values) {
                if (values.hasOwnProperty(key)) {
                    self.origin[key] = values[key].get('current');
                }
            }
        }
        
        return self;
    },
    
    setValues: function (newVals, inherit) {
        var values = this.values.get();
        
        for (var key in newVals) {
            if (newVals.hasOwnProperty(key)) {
                this.setValue(key, newVals[key], inherit);
            }
        }
        
        // If angle and distance exist, create an x and y
        if (this.getValue('angle') && this.getValue('distance')) {
            this.setValue('x');
            this.setValue('y');
        }
    },
    
    
    setValue: function (key, value, inherit) {
        var existing = this.getValue(key),
            newVal;

        // Update if value exists
        if (existing) {
            existing.set(value, inherit);

        // Or create new if it doesn't
        } else {
            newVal = new Value(defaultValue);
            newVal.set(value, inherit);
            
            this.values.set(key, newVal);
        }

        return this;
    },
    
    
    getValue: function (key) {
        return this.values.get(key);
    },
    
    
    setProp: function (key, value) {
        this.props.set(key, value);
        
        return this;
    },
    
    
    getProp: function (key) {
        return this.props.get(key);
    },
    
    /*
        Is Action active?
        
        @param [boolean] (optional): If provided, will set action to active/inactive
        @return [boolean]: Active status
    */
    isActive: function (active) {
        if (active !== undefined) {
            this.active = active;
        }

        return this.active;
    },
    
    /*
        Change Action properties
        
        @param [string]: Type of processing rubix to use
        @param [object]: Base properties of new input
    */
    changeRubix: function (processType) {
        this.props.set('rubix', rubix[processType]);

        return this;
    }
    
};

module.exports = Action;